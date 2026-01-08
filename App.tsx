
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { audioEngine } from './services/audioEngine';
import { getGeminiPresets } from './services/geminiService';
import { AudioSettings, PresetSuggestion } from './types';
import Visualizer from './components/Visualizer';

const Slider: React.FC<{
  label: string,
  value: number,
  min: number,
  max: number,
  step: number,
  unit?: string,
  disabled?: boolean,
  onChange: (v: number) => void,
  thumbColor: string
}> = ({ label, value, min, max, step, unit = '', disabled = false, onChange, thumbColor }) => (
  <div className={`space-y-1 ${disabled ? 'opacity-20 pointer-events-none' : ''}`}>
    <div className="flex justify-between text-[10px] text-slate-400">
      <span>{label}</span>
      <span className="font-mono text-slate-200">{value.toFixed(step >= 1 ? 0 : (step >= 0.1 ? 1 : 3))}{unit}</span>
    </div>
    <input 
      type="range" 
      min={min} 
      max={max} 
      step={step} 
      value={value}
      disabled={disabled}
      onChange={e => onChange(parseFloat(e.target.value))}
      className="w-full slider-input"
      style={{ '--thumb-color': thumbColor } as React.CSSProperties}
    />
  </div>
);

const App: React.FC = () => {
  const [settings, setSettings] = useState<AudioSettings>({
    dryGain: 0.0, 
    wetPathDryGain: 1.0,
    wetGain: 0.25,
    reverbDecay: 2.2,
    reverbPreDelay: 0.05,
    reverbDuration: 1.8,
    lowCut: 350,
    highCut: 12000,
    isProcessing: false,
    bypassEffects: false,
    bypassGain: 1.0,
    masterGain: 1.0,
  });

  const [inputDevices, setInputDevices] = useState<MediaDeviceInfo[]>([]);
  const [outputDevices, setOutputDevices] = useState<MediaDeviceInfo[]>([]);
  const [inputDeviceId, setInputDeviceId] = useState('default');
  const [outputDeviceId, setOutputDeviceId] = useState('default');
  
  const [analysers, setAnalysers] = useState<{in: AnalyserNode | null, out: AnalyserNode | null}>({in: null, out: null});
  
  // AI States
  const [loadingPresets, setLoadingPresets] = useState(false);
  const [aiStatus, setAiStatus] = useState('');
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiPresets, setAiPresets] = useState<PresetSuggestion[]>([]);
  const [aiInput, setAiInput] = useState('');

  const [isStarting, setIsStarting] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isProcessingFile, setIsProcessingFile] = useState(false);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied'>('idle');
  const [autoMuted, setAutoMuted] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ステータスメッセージのローテーション用
  const statusMessages = [
    "Connecting to Gemini...",
    "Analyzing acoustic space...",
    "Modeling reflections...",
    "Calculating RT60 curves...",
    "Generating IR profiles...",
    "Fine-tuning filters...",
    "Optimizing damping..."
  ];

  useEffect(() => {
    let interval: number;
    if (loadingPresets) {
      let idx = 0;
      setAiStatus(statusMessages[0]);
      interval = window.setInterval(() => {
        idx = (idx + 1) % statusMessages.length;
        setAiStatus(statusMessages[idx]);
      }, 2500);
    } else {
      setAiStatus('');
    }
    return () => clearInterval(interval);
  }, [loadingPresets]);

  // 安全装置のコールバックを登録
  useEffect(() => {
    audioEngine.onAutoMuteTriggered = () => setAutoMuted(true);
  }, []);

  const fetchDevices = useCallback(async () => {
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => {});
      const allDevices = await navigator.mediaDevices.enumerateDevices();
      const inputs = allDevices.filter(d => d.kind === 'audioinput');
      const outputs = allDevices.filter(d => d.kind === 'audiooutput');
      
      setInputDevices(inputs);
      setOutputDevices(outputs);

      // 自動ルーティング設定: 入力にBlackHole、出力にそれ以外を優先
      const bhInput = inputs.find(d => d.label.toLowerCase().includes('blackhole'));
      if (bhInput) setInputDeviceId(bhInput.deviceId);

      const speakerOutput = outputs.find(d => 
        !d.label.toLowerCase().includes('blackhole') && 
        d.deviceId !== 'default' && 
        (d.label.toLowerCase().includes('speaker') || d.label.toLowerCase().includes('headphone') || d.label.toLowerCase().includes('internal'))
      );
      if (speakerOutput) setOutputDeviceId(speakerOutput.deviceId);

    } catch (e) { console.warn(e); }
  }, []);

  useEffect(() => {
    fetchDevices();
  }, [fetchDevices]);

  const startEngine = useCallback(async (forcedInputId?: string, file?: File | null) => {
    if (isStarting) return;
    
    const actualInputId = forcedInputId || (inputDeviceId === 'default' ? inputDevices[0]?.deviceId : inputDeviceId);
    const actualOutputId = outputDeviceId === 'default' ? outputDevices[0]?.deviceId : outputDeviceId;
    
    if (actualInputId === actualOutputId && actualInputId && !file) {
      alert("⚠️ フィードバック・ループ防止\n入力と出力に同じデバイスが指定されています。BlackHoleを使用する場合は、入力のみにBlackHoleを指定し、出力は物理スピーカーを指定してください。");
      return;
    }

    setIsStarting(true);
    setAutoMuted(false); // 開始時にアラートをリセット
    try {
      await audioEngine.init(forcedInputId || (inputDeviceId === 'default' ? undefined : inputDeviceId), file || (selectedFile || undefined), outputDeviceId === 'default' ? undefined : outputDeviceId);
      audioEngine.updateSettings(settings);
      setAnalysers({ in: audioEngine.analyserInput, out: audioEngine.analyserOutput });
      setSettings(prev => ({ ...prev, isProcessing: true }));
    } catch (err) {
      console.error(err);
    } finally {
      setIsStarting(false);
    }
  }, [inputDeviceId, outputDeviceId, selectedFile, isStarting, settings, inputDevices, outputDevices]);

  const toggleProcessing = async () => {
    if (isStarting) return;
    
    // 操作が行われた時点でアラートを消す
    setAutoMuted(false);
    
    if (!settings.isProcessing) {
      await startEngine(undefined, selectedFile);
    } else {
      await audioEngine.close();
      setAnalysers({ in: null, out: null });
      setSettings(prev => ({ ...prev, isProcessing: false }));
    }
  };

  useEffect(() => {
    if (settings.isProcessing) {
      audioEngine.updateSettings(settings);
    }
  }, [settings]);

  const applyPreset = (presetSettings: Partial<AudioSettings>) => {
    setSettings(prev => ({
      ...prev,
      ...presetSettings,
      bypassEffects: false,
    }));
  };

  const handleAiSubmit = async () => {
    const value = aiInput.trim();
    if (!value || loadingPresets) return;
    
    setLoadingPresets(true);
    setAiError(null);

    // 60秒のタイムアウト処理（ステータスが表示されるため長めに設定）
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error("AI response timed out. Please try again.")), 60000)
    );

    try {
      const presets = await Promise.race([
        getGeminiPresets(value),
        timeoutPromise
      ]) as PresetSuggestion[];

      if (presets && presets.length > 0) {
        setAiPresets(presets);
        setAiInput(''); 
      } else {
        setAiError("No presets generated. Please refine your description.");
      }
    } catch (err: any) {
      console.error("AI Generation failed", err);
      setAiError(err.message || "Failed to connect to AI. Please check your connection.");
    } finally {
      setLoadingPresets(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setSelectedFile(file);
      e.target.value = "";
      if (settings.isProcessing) {
        audioEngine.close().then(() => {
          setAnalysers({ in: null, out: null });
          setSettings(prev => ({ ...prev, isProcessing: false }));
        });
      }
    }
  };

  const handleClearFile = () => {
    setSelectedFile(null);
    setAutoMuted(false);
    if (settings.isProcessing) {
      audioEngine.close().then(() => {
        setAnalysers({ in: null, out: null });
        setSettings(prev => ({ ...prev, isProcessing: false }));
      });
    }
  };

  const handleProcessFile = async () => {
    if (!selectedFile || isProcessingFile) return;
    setIsProcessingFile(true);
    try {
      const blob = await audioEngine.renderOffline(selectedFile, settings);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `FX_${selectedFile.name.replace(/\.[^/.]+$/, "")}.wav`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("File processing failed", err);
      alert("エラーが発生しました。");
    } finally {
      setIsProcessingFile(false);
    }
  };

  const generateHandoverData = () => {
    return JSON.stringify({
      version: "1.2",
      target: "AudioFX_Handover_Profile",
      timestamp: new Date().toISOString(),
      parameters: {
        rt60: settings.reverbDuration,
        damping: settings.reverbDecay,
        preDelay: settings.reverbPreDelay,
        highPassHz: settings.lowCut,
        lowPassHz: settings.highCut,
        mixRatio: settings.wetGain,
        dryPathGain: settings.wetPathDryGain,
        masterVol: settings.masterGain
      }
    }, null, 2);
  };

  const handleCopyConfig = () => {
    navigator.clipboard.writeText(generateHandoverData());
    setCopyStatus('copied');
    setTimeout(() => setCopyStatus('idle'), 2000);
  };

  return (
    <div className="flex h-screen w-full flex-col md:flex-row overflow-hidden bg-[#0a0a0c]">
      <aside className="w-full md:w-80 h-[45vh] md:h-full p-5 border-b md:border-b-0 md:border-r border-white/10 flex flex-col gap-4 bg-black/40 backdrop-blur-md overflow-y-auto shrink-0 z-20 custom-scrollbar">
        <header className="flex justify-between items-center mb-1 shrink-0">
          <div className="flex flex-col">
            <h1 className="text-lg font-bold bg-gradient-to-r from-blue-400 to-indigo-500 bg-clip-text text-transparent">AudioFX</h1>
            <span className="text-[7px] text-slate-500 uppercase tracking-widest leading-none">Pro Reverb Engine</span>
          </div>
          <button onClick={() => setShowConfig(true)} className="text-[9px] bg-indigo-500/20 hover:bg-indigo-500/30 px-2 py-1 rounded text-indigo-400 border border-indigo-500/30 font-bold uppercase transition-all flex items-center gap-1">
            <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
            Handover
          </button>
        </header>

        {autoMuted && (
          <div className="p-2 bg-red-500/20 border border-red-500 rounded-lg text-center">
            <p className="text-[9px] text-red-400 font-bold animate-pulse">⚠️ AUTO-MUTE TRIGGERED</p>
            <p className="text-[7px] text-red-300">Feedback detected. Settings reset required.</p>
          </div>
        )}

        <div className="space-y-4 pb-4">
          <div className="flex gap-2">
            <button 
              onClick={toggleProcessing} 
              disabled={isStarting}
              className={`flex-[2] py-3 rounded-xl text-xs font-bold transition-all shadow-lg ${settings.isProcessing ? 'bg-red-500 text-white shadow-red-900/20' : 'bg-blue-600 text-white shadow-blue-900/40'}`}
            >
              {isStarting ? '...' : (settings.isProcessing ? 'STOP' : (selectedFile ? 'PREVIEW FILE' : 'START LIVE'))}
            </button>
            <button 
              onClick={() => setSettings(s => ({...s, bypassEffects: !s.bypassEffects}))} 
              disabled={!settings.isProcessing}
              className={`flex-1 py-3 rounded-xl text-[10px] font-bold border transition-all ${settings.bypassEffects ? 'bg-amber-500 border-amber-400 text-white shadow-lg shadow-amber-900/20' : 'bg-white/5 border-white/10 text-slate-400'}`}
            >
              BYPASS
            </button>
          </div>

          <div className="p-3 bg-white/5 rounded-xl border border-white/10 space-y-3">
            <h3 className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Routing</h3>
            <div className="space-y-2">
              <select disabled={!!selectedFile} value={inputDeviceId} onChange={e => setInputDeviceId(e.target.value)} className="w-full bg-black border border-white/10 rounded-lg p-1.5 text-xs text-slate-200 outline-none">
                <option value="default">Default Input</option>
                {inputDevices.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || d.deviceId}</option>)}
              </select>
              <select value={outputDeviceId} onChange={e => setOutputDeviceId(e.target.value)} className="w-full bg-black border border-white/10 rounded-lg p-1.5 text-xs text-slate-200 outline-none">
                <option value="default">Default Output</option>
                {outputDevices.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || d.deviceId}</option>)}
              </select>
            </div>
          </div>

          <div className="p-3 bg-indigo-500/10 rounded-xl border border-indigo-500/30 space-y-3">
            <h3 className="text-[9px] font-bold text-indigo-400 uppercase tracking-widest">File Processing</h3>
            <input type="file" ref={fileInputRef} onChange={handleFileChange} accept="audio/*" className="hidden" />
            <div className="flex gap-1">
              <button onClick={() => fileInputRef.current?.click()} className="flex-1 py-2 bg-black/40 border border-white/10 rounded-lg text-[10px] text-slate-300 truncate px-2 text-left">
                {selectedFile ? selectedFile.name : "Select Audio File..."}
              </button>
              {selectedFile && (
                <button onClick={handleClearFile} className="px-2 bg-red-500/20 text-red-400 border border-red-500/30 rounded-lg hover:bg-red-500/30 transition-all flex items-center justify-center shadow-lg shadow-red-900/10">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              )}
            </div>
            <button onClick={handleProcessFile} disabled={!selectedFile || isProcessingFile} className="w-full py-2 bg-indigo-600 text-white rounded-lg text-[10px] font-bold disabled:opacity-30">
              {isProcessingFile ? "RENDERING..." : "RENDER & DOWNLOAD"}
            </button>
          </div>

          <div className="p-3 bg-white/5 rounded-xl border border-white/10 space-y-4">
            <h3 className="text-[9px] font-bold text-slate-500 uppercase tracking-widest text-center">Mixer</h3>
            <Slider label="Dry Signal" value={settings.wetPathDryGain} min={0} max={1.5} step={0.01} onChange={v => setSettings(s => ({...s, wetPathDryGain: v}))} thumbColor="#94a3b8" />
            <Slider label="Reverb Wet" value={settings.wetGain} min={0} max={1.0} step={0.01} onChange={v => setSettings(s => ({...s, wetGain: v}))} thumbColor="#818cf8" />
            <Slider label="Master Output" value={settings.masterGain} min={0} max={1.5} step={0.01} onChange={v => setSettings(s => ({...s, masterGain: v}))} thumbColor="#f59e0b" />
          </div>

          <div className="p-3 bg-white/5 rounded-xl border border-white/10 space-y-4">
            <h3 className="text-[9px] font-bold text-slate-500 uppercase tracking-widest text-center">Reverb Engine</h3>
            <Slider label="Decay (RT60)" value={settings.reverbDuration} min={0.1} max={10} step={0.1} unit="s" onChange={v => setSettings(s => ({...s, reverbDuration: v}))} thumbColor="#a855f7" />
            <Slider label="Damping" value={settings.reverbDecay} min={1} max={10} step={0.1} onChange={v => setSettings(s => ({...s, reverbDecay: v}))} thumbColor="#ec4899" />
            <Slider label="Pre-Delay" value={settings.reverbPreDelay} min={0} max={0.5} step={0.005} unit="s" onChange={v => setSettings(s => ({...s, reverbPreDelay: v}))} thumbColor="#22d3ee" />
          </div>

          <div className="p-3 bg-white/5 rounded-xl border border-white/10 space-y-4">
            <h3 className="text-[9px] font-bold text-slate-500 uppercase tracking-widest text-center">EQ Filters</h3>
            <Slider label="Low Cut" value={settings.lowCut} min={20} max={2000} step={1} unit="Hz" onChange={v => setSettings(s => ({...s, lowCut: v}))} thumbColor="#10b981" />
            <Slider label="High Cut" value={settings.highCut} min={500} max={20000} step={1} unit="Hz" onChange={v => setSettings(s => ({...s, highCut: v}))} thumbColor="#f43f5e" />
          </div>
        </div>
      </aside>

      <main className="flex-1 h-full flex flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto p-4 md:p-8 space-y-8 custom-scrollbar">
          <div className="h-[300px] md:h-[400px]">
            <Visualizer 
              analyserA={analysers.in} 
              analyserB={analysers.out} 
              colorA="#60a5fa" 
              colorB={settings.bypassEffects ? "#f59e0b" : "#818cf8"} 
              labelA="INPUT" 
              labelB={settings.bypassEffects ? "BYPASSED OUTPUT" : "REVERB MIX OUTPUT"}
            />
          </div>

          <section className="bg-white/5 p-6 md:p-10 rounded-[2.5rem] border border-white/5">
            <h2 className="text-xl md:text-2xl font-bold mb-6 italic">Acoustic Architect</h2>
            <div className="flex gap-2 mb-2">
              <input 
                type="text" 
                value={aiInput}
                placeholder="場所や音響特性を入力..." 
                className="flex-1 bg-black/50 border border-white/10 rounded-2xl px-5 py-4 text-sm focus:border-indigo-500/50 outline-none"
                disabled={loadingPresets}
                onChange={e => setAiInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !e.nativeEvent.isComposing && handleAiSubmit()}
              />
              <button onClick={handleAiSubmit} disabled={loadingPresets || !aiInput.trim()} className="px-8 bg-indigo-600 rounded-2xl text-xs font-bold hover:bg-indigo-500 disabled:opacity-30 min-w-[140px] transition-all">
                {loadingPresets ? aiStatus : 'GENERATE'}
              </button>
            </div>
            
            {aiError && (
              <p className="text-[10px] text-red-400 font-bold mb-6 ml-2 animate-pulse flex items-center gap-1">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                {aiError}
              </p>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-8">
              {aiPresets.map((p, i) => (
                <button key={i} onClick={() => applyPreset(p.settings)} className="text-left p-6 rounded-3xl bg-white/5 border border-white/5 hover:border-indigo-500/50 transition-all group">
                  <h4 className="font-bold text-indigo-400 text-sm mb-2 group-hover:text-indigo-300">{p.name}</h4>
                  <p className="text-[11px] text-slate-400 leading-relaxed italic">"{p.description}"</p>
                </button>
              ))}
            </div>
          </section>
        </div>
      </main>

      {showConfig && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/90 backdrop-blur-xl">
          <div className="bg-[#121214] border border-white/10 rounded-[2.5rem] p-8 max-w-2xl w-full shadow-2xl flex flex-col max-h-[95vh]">
            <div className="flex justify-between items-start mb-6">
              <div>
                <h2 className="text-2xl font-bold text-white mb-1">Handover & Distribution Guide</h2>
                <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold">プロフェッショナル並列出力構成ガイド</p>
              </div>
              <button onClick={() => setShowConfig(false)} className="bg-white/5 p-2 rounded-full"><svg className="w-6 h-6 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-8 pr-2 custom-scrollbar">
              <section className="space-y-3">
                <h3 className="text-[11px] font-bold text-indigo-400 uppercase tracking-widest">1. AI Handover Profile (JSON)</h3>
                <div className="relative bg-black/60 border border-white/10 rounded-2xl overflow-hidden flex flex-col">
                  <div className="flex justify-between items-center px-4 py-2 bg-white/5 border-b border-white/5">
                    <span className="text-[10px] font-mono text-slate-500">acoustic_profile.json</span>
                    <button onClick={handleCopyConfig} className={`text-[10px] font-bold px-3 py-1 rounded transition-all ${copyStatus === 'copied' ? 'bg-emerald-500 text-white' : 'bg-indigo-600 text-white'}`}>
                      {copyStatus === 'copied' ? 'COPIED!' : 'COPY DATA'}
                    </button>
                  </div>
                  <pre className="p-4 font-mono text-[11px] text-indigo-300 whitespace-pre-wrap max-h-[120px] overflow-y-auto">{generateHandoverData()}</pre>
                </div>
              </section>

              <section className="space-y-4">
                <h3 className="text-[11px] font-bold text-amber-400 uppercase tracking-widest flex items-center gap-2">
                  <span className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-pulse"></span>
                  2. Mac Pro-Routing Checklist (配布用重要事項)
                </h3>
                <div className="bg-white/5 p-5 rounded-2xl border border-white/5 space-y-5">
                  <div className="space-y-2">
                    <p className="text-[11px] text-slate-200 font-bold">🔘 Audio MIDI設定の構成</p>
                    <ul className="text-[10px] text-slate-400 space-y-1 ml-4 list-disc">
                      <li>「複数出力装置」を作成し、BlackHoleとスピーカーの両方を選択。</li>
                      <li>BlackHoleの<b className="text-slate-300">「ドリフト補正」</b>を必ず有効にする。同期ズレを防止します。</li>
                      <li>全デバイスのサンプリングレートを<b className="text-slate-300">48kHz</b>に統一すること。</li>
                    </ul>
                  </div>
                </div>
              </section>
            </div>

            <button onClick={() => setShowConfig(false)} className="mt-8 w-full py-4 bg-white/5 border border-white/10 rounded-2xl font-bold text-white transition-all text-xs uppercase tracking-widest">Setup Verified</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
