
import { AudioSettings } from '../types';

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private isInitializing: boolean = false;
  
  private source: MediaStreamAudioSourceNode | AudioBufferSourceNode | null = null;
  
  private wetGainNode: GainNode | null = null;
  private wetPathDryGainNode: GainNode | null = null;
  private bypassGainNode: GainNode | null = null;
  private masterGainNode: GainNode | null = null;
  
  private reverbNode: AudioWorkletNode | null = null;
  private lowCutFilter: BiquadFilterNode | null = null;
  private highCutFilter: BiquadFilterNode | null = null;
  
  public analyserInput: AnalyserNode | null = null;
  public analyserOutput: AnalyserNode | null = null;

  // 安全装置用のプロパティ
  private safetyTimer: number | null = null;
  public onAutoMuteTriggered: (() => void) | null = null;

  private static readonly REVERB_WORKLET_CODE = `
    class ReverbProcessor extends AudioWorkletProcessor {
      static get parameterDescriptors() {
        return [
          { name: 'rt60', defaultValue: 1.5, minValue: 0.1, maxValue: 10.0 },
          { name: 'damping', defaultValue: 2.2, minValue: 1.0, maxValue: 10.0 },
          { name: 'preDelay', defaultValue: 0.05, minValue: 0.0, maxValue: 1.0 }
        ];
      }
      constructor() {
        super();
        const fs = globalThis.sampleRate || 48000;
        const scale = fs / 48000;
        this.delayTimes = [
          Math.floor(1331 * scale), 
          Math.floor(1693 * scale), 
          Math.floor(2011 * scale), 
          Math.floor(2381 * scale)
        ]; 
        this.delayBuffers = this.delayTimes.map(size => new Float32Array(size));
        this.delayPointers = new Int32Array(4).fill(0);
        this.preDelayBuffer = new Float32Array(Math.floor(fs));
        this.preDelayPointer = 0;
        this.lpState = new Float32Array(4).fill(0);
      }
      process(inputs, outputs, parameters) {
        const input = inputs[0];
        const output = outputs[0];
        if (!input || !input[0]) return true;

        const fs = globalThis.sampleRate || 48000;
        const rt60 = parameters.rt60[0];
        const damping = parameters.damping[0];
        const preDelaySeconds = parameters.preDelay[0];

        const feedbackGains = this.delayTimes.map(size => Math.pow(10, (-3 * size) / (rt60 * fs)));
        const lpCoef = Math.min(0.95, 1.0 / damping);

        const inputChannel = input[0];
        const outputL = output[0];
        const outputR = output[1] || outputL;

        for (let i = 0; i < inputChannel.length; i++) {
          const preDelaySamples = Math.min(this.preDelayBuffer.length - 1, Math.floor(preDelaySeconds * fs));
          this.preDelayBuffer[this.preDelayPointer] = inputChannel[i];
          const readPtr = (this.preDelayPointer - preDelaySamples + this.preDelayBuffer.length) % this.preDelayBuffer.length;
          const delayedInput = this.preDelayBuffer[readPtr];
          this.preDelayPointer = (this.preDelayPointer + 1) % this.preDelayBuffer.length;

          const nodeSignals = new Float32Array(4);
          for (let j = 0; j < 4; j++) nodeSignals[j] = this.delayBuffers[j][this.delayPointers[j]];

          const sum = nodeSignals[0] + nodeSignals[1] + nodeSignals[2] + nodeSignals[3];
          const mix = sum * 0.5;
          
          for (let j = 0; j < 4; j++) {
            const val = (nodeSignals[j] - mix) * feedbackGains[j] + delayedInput;
            this.lpState[j] = val * (1 - lpCoef) + this.lpState[j] * lpCoef;
            this.delayBuffers[j][this.delayPointers[j]] = this.lpState[j];
            this.delayPointers[j] = (this.delayPointers[j] + 1) % this.delayTimes[j];
          }

          outputL[i] = (nodeSignals[0] + nodeSignals[2]) * 0.5;
          outputR[i] = (nodeSignals[1] + nodeSignals[3]) * 0.5;
        }
        return true;
      }
    }
    registerProcessor('reverb-processor', ReverbProcessor);
  `;

  private async getWorkletUrl() {
    const blob = new Blob([AudioEngine.REVERB_WORKLET_CODE], { type: 'application/javascript' });
    return URL.createObjectURL(blob);
  }

  async init(inputDeviceId?: string, previewFile?: File, outputDeviceId?: string) {
    if (this.isInitializing) return;
    this.isInitializing = true;

    try {
      await this.close();
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 48000 });
      
      if (outputDeviceId && outputDeviceId !== 'default' && (this.ctx as any).setSinkId) {
        await (this.ctx as any).setSinkId(outputDeviceId);
      }

      const workletUrl = await this.getWorkletUrl();
      await this.ctx.audioWorklet.addModule(workletUrl);
      URL.revokeObjectURL(workletUrl);

      if (previewFile) {
        const buffer = await previewFile.arrayBuffer();
        const audioBuffer = await this.ctx.decodeAudioData(buffer);
        const sourceNode = this.ctx.createBufferSource();
        sourceNode.buffer = audioBuffer;
        sourceNode.loop = true;
        this.source = sourceNode;
      } else {
        const constraints: MediaStreamConstraints = {
          audio: {
            deviceId: inputDeviceId ? { exact: inputDeviceId } : undefined,
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          }
        };
        this.stream = await navigator.mediaDevices.getUserMedia(constraints);
        this.source = this.ctx.createMediaStreamSource(this.stream);
      }

      this.analyserInput = this.ctx.createAnalyser();
      this.analyserOutput = this.ctx.createAnalyser();
      this.analyserInput.fftSize = 2048;
      this.analyserOutput.fftSize = 2048;

      this.lowCutFilter = this.ctx.createBiquadFilter();
      this.lowCutFilter.type = 'highpass';
      this.highCutFilter = this.ctx.createBiquadFilter();
      this.highCutFilter.type = 'lowpass';
      
      this.reverbNode = new AudioWorkletNode(this.ctx, 'reverb-processor');
      this.wetGainNode = this.ctx.createGain();
      this.wetPathDryGainNode = this.ctx.createGain();
      this.bypassGainNode = this.ctx.createGain();
      this.masterGainNode = this.ctx.createGain();

      this.source.connect(this.analyserInput);

      this.source.connect(this.lowCutFilter);
      this.lowCutFilter.connect(this.highCutFilter);
      this.highCutFilter.connect(this.reverbNode);
      this.reverbNode.connect(this.wetGainNode);
      this.source.connect(this.wetPathDryGainNode);
      this.source.connect(this.bypassGainNode);

      this.wetGainNode.connect(this.masterGainNode);
      this.wetPathDryGainNode.connect(this.masterGainNode);
      this.bypassGainNode.connect(this.masterGainNode);

      this.masterGainNode.connect(this.analyserOutput);
      this.analyserOutput.connect(this.ctx.destination);

      if (this.ctx.state === 'suspended') {
        await this.ctx.resume();
      }

      if (this.source instanceof AudioBufferSourceNode) {
        this.source.start(0);
      }

      // 安全装置のレベル監視を開始
      this.startSafetyMonitoring();

    } catch (e) {
      console.error("AudioEngine init failed", e);
      throw e;
    } finally {
      this.isInitializing = false;
    }
  }

  private startSafetyMonitoring() {
    if (!this.analyserOutput) return;
    const dataArray = new Float32Array(this.analyserOutput.fftSize);
    
    const checkLevel = () => {
      if (!this.analyserOutput || !this.masterGainNode) return;
      this.analyserOutput.getFloatTimeDomainData(dataArray);
      
      let max = 0;
      for (let i = 0; i < dataArray.length; i++) {
        const abs = Math.abs(dataArray[i]);
        if (abs > max) max = abs;
      }

      // 1.5倍(約3.5dB)を超えるピークをフィードバックとみなす
      if (max > 1.5) {
        this.masterGainNode.gain.value = 0;
        if (this.onAutoMuteTriggered) this.onAutoMuteTriggered();
        console.warn("CRITICAL: Feedback detected. Auto-mute triggered.");
        return;
      }
      this.safetyTimer = requestAnimationFrame(checkLevel);
    };
    this.safetyTimer = requestAnimationFrame(checkLevel);
  }

  updateSettings(settings: AudioSettings) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const ramp = 0.05;

    if (this.lowCutFilter) this.lowCutFilter.frequency.setTargetAtTime(settings.lowCut, now, ramp);
    if (this.highCutFilter) this.highCutFilter.frequency.setTargetAtTime(settings.highCut, now, ramp);
    
    if (this.reverbNode) {
      const rt60 = this.reverbNode.parameters.get('rt60');
      const damping = this.reverbNode.parameters.get('damping');
      const preDelay = this.reverbNode.parameters.get('preDelay');
      if (rt60) rt60.setTargetAtTime(settings.reverbDuration, now, ramp);
      if (damping) damping.setTargetAtTime(settings.reverbDecay, now, ramp);
      if (preDelay) preDelay.setTargetAtTime(settings.reverbPreDelay, now, ramp);
    }

    if (this.masterGainNode) {
      this.masterGainNode.gain.setTargetAtTime(settings.masterGain, now, ramp);
    }

    if (settings.bypassEffects) {
      if (this.wetGainNode) this.wetGainNode.gain.setTargetAtTime(0, now, ramp);
      if (this.wetPathDryGainNode) this.wetPathDryGainNode.gain.setTargetAtTime(0, now, ramp);
      if (this.bypassGainNode) this.bypassGainNode.gain.setTargetAtTime(1.0, now, ramp);
    } else {
      if (this.wetGainNode) this.wetGainNode.gain.setTargetAtTime(settings.wetGain, now, ramp);
      if (this.wetPathDryGainNode) this.wetPathDryGainNode.gain.setTargetAtTime(settings.wetPathDryGain, now, ramp);
      if (this.bypassGainNode) this.bypassGainNode.gain.setTargetAtTime(0, now, ramp);
    }
  }

  async close() {
    if (this.safetyTimer) cancelAnimationFrame(this.safetyTimer);
    if (this.source instanceof AudioBufferSourceNode) {
      try { this.source.stop(); } catch(e) {}
    }
    if (this.ctx) { 
      try { await this.ctx.close(); } catch(e) {} 
      this.ctx = null; 
    }
    if (this.stream) { 
      this.stream.getTracks().forEach(t => t.stop()); 
      this.stream = null; 
    }
    this.source = null;
    this.reverbNode = null;
    this.masterGainNode = null;
    this.analyserInput = null;
    this.analyserOutput = null;
  }

  async renderOffline(file: File, settings: AudioSettings): Promise<Blob> {
    const arrayBuffer = await file.arrayBuffer();
    const tempCtx = new AudioContext({ sampleRate: 48000 });
    const sourceBuffer = await tempCtx.decodeAudioData(arrayBuffer);
    await tempCtx.close();

    const renderDuration = sourceBuffer.duration + settings.reverbDuration + 0.5;
    const offlineCtx = new OfflineAudioContext(2, Math.ceil(renderDuration * 48000), 48000);
    
    const workletUrl = await this.getWorkletUrl();
    await offlineCtx.audioWorklet.addModule(workletUrl);

    const source = offlineCtx.createBufferSource();
    source.buffer = sourceBuffer;

    const master = offlineCtx.createGain();
    master.gain.value = settings.masterGain;

    if (settings.bypassEffects) {
      source.connect(master);
      master.connect(offlineCtx.destination);
    } else {
      const lowCut = offlineCtx.createBiquadFilter();
      lowCut.type = 'highpass';
      lowCut.frequency.value = settings.lowCut;

      const highCut = offlineCtx.createBiquadFilter();
      highCut.type = 'lowpass';
      highCut.frequency.value = settings.highCut;

      const reverb = new AudioWorkletNode(offlineCtx, 'reverb-processor', {
        parameterData: {
          rt60: settings.reverbDuration,
          damping: settings.reverbDecay,
          preDelay: settings.reverbPreDelay
        }
      });

      const wetGain = offlineCtx.createGain();
      wetGain.gain.value = settings.wetGain;
      const dryPathGain = offlineCtx.createGain();
      dryPathGain.gain.value = settings.wetPathDryGain;

      source.connect(lowCut);
      lowCut.connect(highCut);
      highCut.connect(reverb);
      reverb.connect(wetGain);
      wetGain.connect(master);

      source.connect(dryPathGain);
      dryPathGain.connect(master);

      master.connect(offlineCtx.destination);
    }

    source.start(0);
    const renderedBuffer = await offlineCtx.startRendering();
    return this.bufferToWav(renderedBuffer);
  }

  private bufferToWav(buffer: AudioBuffer): Blob {
    const numOfChan = buffer.numberOfChannels;
    const length = buffer.length * numOfChan * 2 + 44;
    const bufferArr = new ArrayBuffer(length);
    const view = new DataView(bufferArr);
    const channels = [];
    let pos = 0;
    const setString = (s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(pos++, s.charCodeAt(i)); };
    setString('RIFF');
    view.setUint32(pos, length - 8, true); pos += 4;
    setString('WAVE');
    setString('fmt ');
    view.setUint32(pos, 16, true); pos += 4;
    view.setUint16(pos, 1, true); pos += 2;
    view.setUint16(pos, numOfChan, true); pos += 2;
    view.setUint32(pos, buffer.sampleRate, true); pos += 4;
    view.setUint32(pos, buffer.sampleRate * 2 * numOfChan, true); pos += 4;
    view.setUint16(pos, numOfChan * 2, true); pos += 2;
    view.setUint16(pos, 16, true); pos += 2;
    setString('data');
    view.setUint32(pos, length - pos - 4, true); pos += 4;
    for (let i = 0; i < buffer.numberOfChannels; i++) channels.push(buffer.getChannelData(i));
    let offset = 0;
    while (pos < length) {
      for (let i = 0; i < numOfChan; i++) {
        let sample = Math.max(-1, Math.min(1, channels[i][offset]));
        sample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
        view.setInt16(pos, sample, true);
        pos += 2;
      }
      offset++;
    }
    return new Blob([bufferArr], { type: 'audio/wav' });
  }
}
export const audioEngine = new AudioEngine();
