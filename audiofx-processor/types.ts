
export interface AudioSettings {
  dryGain: number;
  wetGain: number;
  wetPathDryGain: number;
  reverbDecay: number;
  reverbPreDelay: number;
  reverbDuration: number;
  lowCut: number;
  highCut: number;
  isProcessing: boolean;
  bypassEffects: boolean;
  bypassGain: number; 
}

// AIへの受け渡しを最適化したプロファイル形式
export interface AudioEnvironmentProfile {
  version: string;
  // AIがパラメータの定義を誤解しないためのヒント
  "@context": {
    rt60: "Reverb duration in seconds (Time to decay by 60dB)";
    damping: "High-frequency absorption factor (1.0 = linear, 10.0 = heavy damping)";
    preDelay: "Initial delay before reverb starts in seconds";
    highPassHz: "Low-cut filter frequency in Hertz";
    lowPassHz: "High-cut filter frequency in Hertz";
    mixRatio: "Dry/Wet balance (0.0 = Dry, 1.0 = Wet)";
  };
  metadata: {
    name: string;
    targetEnvironment: string;
    engineerNotes: string;
  };
  parameters: {
    rt60: number;
    damping: number;
    preDelay: number;
    highPassHz: number;
    lowPassHz: number;
    mixRatio: number;
  };
}

export interface PresetSuggestion {
  name: string;
  description: string;
  settings: Partial<AudioSettings>;
}
