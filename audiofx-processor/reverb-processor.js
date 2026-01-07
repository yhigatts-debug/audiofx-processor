
/**
 * FDN (Feedback Delay Network) Reverb Processor
 * リアルタイムでのパラメータ変更に対応した軽量・高品質リバーブ
 */
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
    // グローバルの sampleRate を使用 (AudioWorkletGlobalScope)
    const fs = globalThis.sampleRate || 48000;
    
    // 4本のディレイライン（素数に近いサンプル数で共振を回避）
    // サンプリングレートに応じてスケーリング
    const scale = fs / 48000;
    this.delayTimes = [
      Math.floor(1331 * scale), 
      Math.floor(1693 * scale), 
      Math.floor(2011 * scale), 
      Math.floor(2381 * scale)
    ]; 
    
    this.delayBuffers = this.delayTimes.map(size => new Float32Array(size));
    this.delayPointers = new Int32Array(4).fill(0);
    
    // プリディレイ用バッファ (最大1秒分確保)
    this.preDelayBuffer = new Float32Array(Math.floor(fs));
    this.preDelayPointer = 0;

    // ローパスフィルタ（Damping用）の内部状態
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

    // フィードバックゲインの計算 (RT60から算出)
    const feedbackGains = this.delayTimes.map(size => 
      Math.pow(10, (-3 * size) / (rt60 * fs))
    );

    // Damping係数 (簡易的な1ポールLPF)
    const lpCoef = Math.min(0.95, 1.0 / damping);

    const inputChannel = input[0];
    const outputL = output[0];
    const outputR = output[1] || outputL;

    for (let i = 0; i < inputChannel.length; i++) {
      // 1. プリディレイ処理
      const preDelaySamples = Math.min(this.preDelayBuffer.length - 1, Math.floor(preDelaySeconds * fs));
      this.preDelayBuffer[this.preDelayPointer] = inputChannel[i];
      const readPtr = (this.preDelayPointer - preDelaySamples + this.preDelayBuffer.length) % this.preDelayBuffer.length;
      const delayedInput = this.preDelayBuffer[readPtr];
      this.preDelayPointer = (this.preDelayPointer + 1) % this.preDelayBuffer.length;

      // 2. FDN 処理 (4x4 ハウスホルダー行列)
      const nodeSignals = new Float32Array(4);
      for (let j = 0; j < 4; j++) {
        nodeSignals[j] = this.delayBuffers[j][this.delayPointers[j]];
      }

      // ハウスホルダー行列によるミキシング
      const sum = nodeSignals[0] + nodeSignals[1] + nodeSignals[2] + nodeSignals[3];
      const mix = sum * 0.5; // 2/N where N=4
      
      for (let j = 0; j < 4; j++) {
        const val = (nodeSignals[j] - mix) * feedbackGains[j] + delayedInput;
        
        // Damping (Low Pass Filter)
        this.lpState[j] = val * (1 - lpCoef) + this.lpState[j] * lpCoef;
        
        this.delayBuffers[j][this.delayPointers[j]] = this.lpState[j];
        this.delayPointers[j] = (this.delayPointers[j] + 1) % this.delayTimes[j];
      }

      // 3. 出力 (簡易的なパンニング)
      outputL[i] = (nodeSignals[0] + nodeSignals[2]) * 0.5;
      outputR[i] = (nodeSignals[1] + nodeSignals[3]) * 0.5;
    }

    return true;
  }
}

registerProcessor('reverb-processor', ReverbProcessor);
