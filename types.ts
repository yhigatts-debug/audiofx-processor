
export interface AudioSettings {
  wetGain: number;
  wetPathDryGain: number;
  
  // 共通パラメータ
  reverbDuration: number; // RT60
  reverbPreDelay: number;
  lowCut: number;
  highCut: number;
  masterGain: number;
  
  // Lexicon系
  lexSpin: number;
  lexWander: number;
  lexBassMult: number;
  
  // Bricasti系
  briDensity: number;
  briSize: number;
  briVRoll: number;
  
  // TC系
  tcAir: number;
  tcEarlyLate: number;
  tcHiDamp: number;

  isProcessing: boolean;
  bypassEffects: boolean;
  algoMode: 'lexicon' | 'bricasti' | 'tcelectronic';
}

export interface PresetSuggestion {
  name: string;
  description: string;
  settings: Partial<AudioSettings>;
}
