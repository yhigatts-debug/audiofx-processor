
import { AudioSettings } from '../types';

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private isInitializing: boolean = false;
  
  private source: MediaStreamAudioSourceNode | AudioBufferSourceNode | null = null;
  private dryGainNode: GainNode | null = null;
  private wetGainNode: GainNode | null = null;
  private masterGainNode: GainNode | null = null;
  
  private reverbNode: AudioWorkletNode | null = null;
  private lowCutFilter: BiquadFilterNode | null = null;
  private highCutFilter: BiquadFilterNode | null = null;
  
  public analyserInput: AnalyserNode | null = null;
  public analyserOutput: AnalyserNode | null = null;

  private recorderDestination: MediaStreamAudioDestinationNode | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private recordedChunks: Blob[] = [];

  private static readonly REVERB_WORKLET_CODE = `
    class ReverbProcessor extends AudioWorkletProcessor {
      static get parameterDescriptors() {
        return [
          { name: 'mode', defaultValue: 0 },
          { name: 'rt60', defaultValue: 2.4 },
          { name: 'preDelay', defaultValue: 0.03 },
          { name: 'lexSpin', defaultValue: 0.6 },
          { name: 'lexWander', defaultValue: 0.4 },
          { name: 'briDensity', defaultValue: 0.75 },
          { name: 'briSize', defaultValue: 1.0 },
          { name: 'tcAir', defaultValue: 0.5 },
          { name: 'tcEarlyLate', defaultValue: 0.4 },
          { name: 'tcHiDamp', defaultValue: 0.6 }
        ];
      }

      constructor() {
        super();
        const fs = globalThis.sampleRate || 44100;

        this.lexLen = [1487, 1877, 2237, 2593].map(l => Math.floor(l * (fs/44100)));
        this.lexBufs = this.lexLen.map(l => new Float32Array(l));
        this.lexPtrs = new Int32Array(4);
        
        this.briBaseL = [1116, 1356, 1422, 1610].map(l => Math.floor(l * (fs/44100)));
        this.briBaseR = [1131, 1372, 1438, 1625].map(l => Math.floor(l * (fs/44100)));
        this.briBufsL = this.briBaseL.map(l => new Float32Array(l * 6));
        this.briBufsR = this.briBaseR.map(l => new Float32Array(l * 6));
        this.briPtrsL = new Int32Array(4);
        this.briPtrsR = new Int32Array(4);

        this.tcLen = [1116, 1356, 1422, 1610, 1850, 1990, 2251, 2393].map(l => Math.floor(l * (fs/44100)));
        this.tcBufs = this.tcLen.map(l => new Float32Array(l));
        this.tcPtrs = new Int32Array(8);

        this.preBuf = new Float32Array(fs); 
        this.prePtr = 0;
        this.lfo = 0;
      }

      process(inputs, outputs, parameters) {
        const outL = outputs[0][0];
        const outR = outputs[0][1] || outL;
        const input = inputs[0]?.[0];
        if (!input) return true;

        const mode = parameters.mode[0];
        const fs = globalThis.sampleRate || 44100;
        const rt60 = Math.max(0.1, parameters.rt60[0]);
        const preSamples = Math.floor(Math.min(0.9, parameters.preDelay[0]) * fs);
        const preBufLen = this.preBuf.length;

        // Common Gains
        const gLex = Math.pow(10, -3 / (rt60 * 1.5));
        const gBri = Math.pow(10, -3 / (rt60 * 0.85));
        const gTc = Math.pow(10, -3 / (rt60 * 1.8));

        // Algorithm Specifics
        const lexSpin = parameters.lexSpin[0];
        const lexWander = parameters.lexWander[0];
        const briDensity = parameters.briDensity[0];
        const briSize = parameters.briSize[0];
        const tcAir = parameters.tcAir[0];
        const tcEarlyLate = parameters.tcEarlyLate[0];
        const tcHiDamp = parameters.tcHiDamp[0];

        for (let i = 0; i < input.length; i++) {
          const dryIn = input[i];
          this.preBuf[this.prePtr] = dryIn;
          let rIdx = (this.prePtr - preSamples + preBufLen) % preBufLen;
          const dry = this.preBuf[rIdx];
          this.prePtr = (this.prePtr + 1) % preBufLen;

          let sL = 0, sR = 0;

          if (mode < 0.5) { // LEXICON FDN
            this.lfo += 0.001 * lexSpin;
            const mod = Math.sin(this.lfo) * lexWander * 10;
            let sum = 0;
            for(let j=0; j<4; j++) sum += this.lexBufs[j][this.lexPtrs[j]];
            let mix = sum * 0.25;
            for(let j=0; j<4; j++) {
              let val = this.lexBufs[j][this.lexPtrs[j]];
              this.lexBufs[j][this.lexPtrs[j]] = (val - mix) * gLex + dry;
              this.lexPtrs[j] = (this.lexPtrs[j] + 1) % this.lexLen[j];
            }
            sL = (this.lexBufs[0][this.lexPtrs[0]] + this.lexBufs[2][this.lexPtrs[2]]) * 0.5 + dry * 0.5;
            sR = (this.lexBufs[1][this.lexPtrs[1]] + this.lexBufs[3][this.lexPtrs[3]]) * 0.5 + dry * 0.5;

          } else if (mode < 1.5) { // BRICASTI SCHROEDER
            let combL = 0, combR = 0;
            for(let j=0; j<4; j++) {
              let lenL = Math.floor(this.briBaseL[j] * briSize);
              let lenR = Math.floor(this.briBaseR[j] * briSize);
              let vL = this.briBufsL[j][this.briPtrsL[j] % lenL];
              let vR = this.briBufsR[j][this.briPtrsR[j] % lenR];
              this.briBufsL[j][this.briPtrsL[j] % lenL] = dry + vL * gBri * briDensity;
              this.briBufsR[j][this.briPtrsR[j] % lenR] = dry + vR * gBri * briDensity;
              this.briPtrsL[j]++; this.briPtrsR[j]++;
              combL += vL; combR += vR;
            }
            sL = combL * 0.25; sR = combR * 0.25;

          } else { // TC FDN8
            let sum = 0;
            for(let j=0; j<8; j++) sum += this.tcBufs[j][this.tcPtrs[j]];
            let mix = (sum * 0.125) * tcAir;
            let damp = 1.0 - (tcHiDamp * 0.2);
            for(let j=0; j<8; j++) {
              let val = this.tcBufs[j][this.tcPtrs[j]];
              this.tcBufs[j][this.tcPtrs[j]] = (val - mix) * gTc * damp + dry;
              this.tcPtrs[j] = (this.tcPtrs[j] + 1) % this.tcLen[j];
            }
            sL = (this.tcBufs[0][this.tcPtrs[0]] + this.tcBufs[2][this.tcPtrs[2]]) * (1.0 - tcEarlyLate) + dry * tcEarlyLate;
            sR = (this.tcBufs[1][this.tcPtrs[1]] + this.tcBufs[3][this.tcPtrs[3]]) * (1.0 - tcEarlyLate) + dry * tcEarlyLate;
          }

          outL[i] = sL; outR[i] = sR;
        }
        return true;
      }
    }
    registerProcessor('reverb-processor', ReverbProcessor);
  `;

  async init(inputDeviceId?: string, previewFile?: File, outputDeviceId?: string) {
    if (this.isInitializing) return;
    this.isInitializing = true;
    try {
      await this.close();
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 44100 });
      if (outputDeviceId && outputDeviceId !== 'default' && (this.ctx as any).setSinkId) {
        await (this.ctx as any).setSinkId(outputDeviceId).catch(console.error);
      }
      const blob = new Blob([AudioEngine.REVERB_WORKLET_CODE], { type: 'application/javascript' });
      const url = URL.createObjectURL(blob);
      await this.ctx.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);

      if (previewFile) {
        const buffer = await previewFile.arrayBuffer();
        const audioBuffer = await this.ctx.decodeAudioData(buffer);
        const sourceNode = this.ctx.createBufferSource();
        sourceNode.buffer = audioBuffer;
        sourceNode.loop = true;
        this.source = sourceNode;
      } else {
        const stream = await navigator.mediaDevices.getUserMedia({ 
          audio: { deviceId: inputDeviceId ? { exact: inputDeviceId } : undefined, echoCancellation: false, noiseSuppression: false, autoGainControl: false } 
        });
        this.stream = stream;
        this.source = this.ctx.createMediaStreamSource(stream);
      }

      this.analyserInput = this.ctx.createAnalyser();
      this.analyserInput.fftSize = 2048;
      this.analyserOutput = this.ctx.createAnalyser();
      this.analyserOutput.fftSize = 2048;
      
      this.dryGainNode = this.ctx.createGain();
      this.wetGainNode = this.ctx.createGain();
      this.masterGainNode = this.ctx.createGain();
      this.lowCutFilter = this.ctx.createBiquadFilter();
      this.lowCutFilter.type = 'highpass';
      this.highCutFilter = this.ctx.createBiquadFilter();
      this.highCutFilter.type = 'lowpass';
      this.reverbNode = new AudioWorkletNode(this.ctx, 'reverb-processor');
      this.recorderDestination = this.ctx.createMediaStreamDestination();

      this.source.connect(this.analyserInput);
      this.source.connect(this.dryGainNode);
      this.dryGainNode.connect(this.masterGainNode);
      this.source.connect(this.lowCutFilter);
      this.lowCutFilter.connect(this.highCutFilter);
      this.highCutFilter.connect(this.reverbNode);
      this.reverbNode.connect(this.wetGainNode);
      this.wetGainNode.connect(this.masterGainNode);
      this.masterGainNode.connect(this.analyserOutput);
      this.analyserOutput.connect(this.ctx.destination);
      this.masterGainNode.connect(this.recorderDestination);

      if (this.ctx.state === 'suspended') await this.ctx.resume();
      if (this.source instanceof AudioBufferSourceNode) this.source.start(0);
    } catch (err) { throw err; } finally { this.isInitializing = false; }
  }

  startRecording() {
    if (!this.recorderDestination) return;
    this.recordedChunks = [];
    this.mediaRecorder = new MediaRecorder(this.recorderDestination.stream);
    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.recordedChunks.push(e.data);
    };
    this.mediaRecorder.start();
  }

  async stopRecording(): Promise<Blob> {
    return new Promise((resolve) => {
      if (!this.mediaRecorder) {
        resolve(new Blob());
        return;
      }
      this.mediaRecorder.onstop = () => {
        const blob = new Blob(this.recordedChunks, { type: 'audio/webm' });
        resolve(blob);
      };
      this.mediaRecorder.stop();
    });
  }

  updateSettings(settings: AudioSettings) {
    if (!this.ctx || !this.reverbNode) return;
    const now = this.ctx.currentTime;
    const p = this.reverbNode.parameters;
    
    this.lowCutFilter?.frequency.setTargetAtTime(settings.lowCut, now, 0.05);
    this.highCutFilter?.frequency.setTargetAtTime(settings.highCut, now, 0.05);
    
    p.get('mode')?.setValueAtTime(settings.algoMode === 'lexicon' ? 0 : settings.algoMode === 'bricasti' ? 1 : 2, now);
    p.get('rt60')?.setTargetAtTime(settings.reverbDuration, now, 0.05);
    p.get('preDelay')?.setTargetAtTime(settings.reverbPreDelay, now, 0.05);
    
    p.get('lexSpin')?.setTargetAtTime(settings.lexSpin, now, 0.05);
    p.get('lexWander')?.setTargetAtTime(settings.lexWander, now, 0.05);
    p.get('briDensity')?.setTargetAtTime(settings.briDensity, now, 0.05);
    p.get('briSize')?.setTargetAtTime(settings.briSize, now, 0.05);
    p.get('tcAir')?.setTargetAtTime(settings.tcAir, now, 0.05);
    p.get('tcEarlyLate')?.setTargetAtTime(settings.tcEarlyLate, now, 0.05);
    p.get('tcHiDamp')?.setTargetAtTime(settings.tcHiDamp, now, 0.05);

    this.masterGainNode?.gain.setTargetAtTime(settings.masterGain, now, 0.05);
    
    this.dryGainNode?.gain.setTargetAtTime(settings.wetPathDryGain, now, 0.05);
    this.wetGainNode?.gain.setTargetAtTime(settings.wetGain, now, 0.05);
  }

  async renderOffline(file: File, settings: AudioSettings): Promise<Blob> {
    const arrayBuffer = await file.arrayBuffer();
    const tempCtx = new AudioContext({ sampleRate: 44100 });
    const audioBuffer = await tempCtx.decodeAudioData(arrayBuffer);
    await tempCtx.close();

    const offlineCtx = new OfflineAudioContext(2, audioBuffer.length, 44100);
    const blob = new Blob([AudioEngine.REVERB_WORKLET_CODE], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    await offlineCtx.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);

    const source = offlineCtx.createBufferSource();
    source.buffer = audioBuffer;
    
    const lowCut = offlineCtx.createBiquadFilter();
    lowCut.type = 'highpass';
    lowCut.frequency.setValueAtTime(settings.lowCut, 0);
    
    const highCut = offlineCtx.createBiquadFilter();
    highCut.type = 'lowpass';
    highCut.frequency.setValueAtTime(settings.highCut, 0);
    
    const reverb = new AudioWorkletNode(offlineCtx, 'reverb-processor');
    const p = reverb.parameters;
    p.get('mode')?.setValueAtTime(settings.algoMode === 'lexicon' ? 0 : settings.algoMode === 'bricasti' ? 1 : 2, 0);
    p.get('rt60')?.setValueAtTime(settings.reverbDuration, 0);
    p.get('preDelay')?.setValueAtTime(settings.reverbPreDelay, 0);
    p.get('lexSpin')?.setValueAtTime(settings.lexSpin, 0);
    p.get('lexWander')?.setValueAtTime(settings.lexWander, 0);
    p.get('briDensity')?.setValueAtTime(settings.briDensity, 0);
    p.get('briSize')?.setValueAtTime(settings.briSize, 0);
    p.get('tcAir')?.setValueAtTime(settings.tcAir, 0);
    p.get('tcEarlyLate')?.setValueAtTime(settings.tcEarlyLate, 0);
    p.get('tcHiDamp')?.setValueAtTime(settings.tcHiDamp, 0);

    const dryGain = offlineCtx.createGain();
    const wetGain = offlineCtx.createGain();
    const masterGain = offlineCtx.createGain();

    dryGain.gain.setValueAtTime(settings.wetPathDryGain, 0);
    wetGain.gain.setValueAtTime(settings.wetGain, 0);
    masterGain.gain.setValueAtTime(settings.masterGain, 0);

    source.connect(dryGain);
    dryGain.connect(masterGain);
    source.connect(lowCut);
    lowCut.connect(highCut);
    highCut.connect(reverb);
    reverb.connect(wetGain);
    wetGain.connect(masterGain);
    masterGain.connect(offlineCtx.destination);

    source.start(0);
    const renderedBuffer = await offlineCtx.startRendering();
    return this.bufferToWav(renderedBuffer);
  }

  private bufferToWav(buffer: AudioBuffer): Blob {
    const length = buffer.length * buffer.numberOfChannels * 2 + 44;
    const view = new DataView(new ArrayBuffer(length));
    const writeString = (offset: number, string: string) => {
      for (let i = 0; i < string.length; i++) view.setUint8(offset + i, string.charCodeAt(i));
    };
    writeString(0, 'RIFF');
    view.setUint32(4, length - 8, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, buffer.numberOfChannels, true);
    view.setUint32(24, buffer.sampleRate, true);
    view.setUint32(28, buffer.sampleRate * 4, true);
    view.setUint16(32, buffer.numberOfChannels * 2, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, length - 44, true);

    let offset = 44;
    for (let i = 0; i < buffer.length; i++) {
      for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
        let sample = buffer.getChannelData(channel)[i];
        sample = Math.max(-1.0, Math.min(1.0, sample));
        view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
        offset += 2;
      }
    }
    return new Blob([view], { type: 'audio/wav' });
  }

  async close() {
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    }
    if (this.ctx) {
      if (this.ctx.state !== 'closed') await this.ctx.close().catch(() => {});
    }
    this.ctx = null;
    this.stream?.getTracks().forEach(t => t.stop());
    this.source = null;
  }
}
export const audioEngine = new AudioEngine();
