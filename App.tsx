
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
  colorClass?: string
}> = ({ label, value, min, max, step, unit = '', disabled = false, onChange, colorClass = 'accent-blue-500' }) => (
  <div className={`space-y-1 ${disabled ? 'opacity-30 pointer-events-none' : ''}`}>
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
      className={`w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer ${colorClass}`}
    />
  </div>
);

const App: React.FC = () => {
  const [settings, setSettings] = useState<AudioSettings>({
    dryGain: 1.0, 
    wetPathDryGain: 1.0,
    wetGain: 0.15,
    reverbDecay: 2.2,
    reverbPreDelay: 0.05,
    reverbDuration: 1.5,
    lowCut: 400,
    highCut: 15000,
    isProcessing: false,
    bypassEffects: false,
    bypassGain: 1.0,
  });

  const [inputDevices, setInputDevices] = useState<MediaDeviceInfo[]>([]);
  const [outputDevices, setOutputDevices] = useState<MediaDeviceInfo[]>([]);
  const [inputDeviceId, setInputDeviceId] = useState('default');
  const [outputDeviceId, setOutputDeviceId] = useState('default');
  
  // Analyser states to force re-render on device switch
  const [analysers, setAnalysers] = useState<{in: AnalyserNode | null, out: AnalyserNode | null}>({in: null, out: null});
  
  const [loadingPresets, setLoadingPresets] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [aiPresets, setAiPresets] = useState<PresetSuggestion[]>([]);
  const [showConfig, setShowConfig] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);
  
  const [aiInput, setAiInput] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isProcessingFile, setIsProcessingFile] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchDevices = useCallback(async () => {
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => {});
      const allDevices = await navigator.mediaDevices.enumerateDevices();
      setInputDevices(allDevices.filter(d => d.kind === 'audioinput'));
      setOutputDevices(allDevices.filter(d => d.kind === 'audiooutput'));
    } catch (e) { console.warn(e); }
  }, []);

  useEffect(() => {
    fetchDevices();
  }, [fetchDevices]);

  const startEngine = async (forcedDeviceId?: string, file?: File | null) => {
    setIsStarting(true);
    try {
      await audioEngine.init(
        (forcedDeviceId || inputDeviceId) === 'default' ? undefined : (forcedDeviceId || inputDeviceId),
        file || undefined,
        outputDeviceId === 'default' ? undefined : outputDeviceId
      );
      audioEngine.updateSettings(settings);
      setAnalysers({ in: audioEngine.analyserInput, out: audioEngine.analyserOutput });
      setSettings(prev => ({ ...prev, isProcessing: true }));
    } catch (err) {
      console.error(err);
      alert("エンジンの起動に失敗しました。デバイスが他で使用されていないか、ブラウザのマイク許可を確認してください。");
    } finally {
      setIsStarting(false);
    }
  };

  const toggleProcessing = async () => {
    if (isStarting) return;
    if (!settings.isProcessing) {
      // ファイルが選択されている場合は、startEngineに渡す
      await startEngine(undefined, selectedFile);
    } else {
      await audioEngine.close();
      setAnalysers({ in: null, out: null });
      setSettings(prev => ({ ...prev, isProcessing: false }));
    }
  };

  // Handle device change while running
  useEffect(() => {
    if (settings.isProcessing && !isStarting) {
      startEngine(undefined, selectedFile);
    }
  }, [inputDeviceId, outputDeviceId]);

  useEffect(() => {
    if (settings.isProcessing) audioEngine.updateSettings(settings);
  }, [settings, settings.isProcessing]);

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
    try {
      const presets = await getGeminiPresets(value);
      if (presets && presets.length > 0) {
        setAiPresets(presets);
        setAiInput(''); 
      }
    } catch (err) {
      console.error("AI Generation failed", err);
    } finally {
      setLoadingPresets(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setSelectedFile(file);
      if (settings.isProcessing) {
        audioEngine.close();
        setAnalysers({ in: null, out: null });
        setSettings(prev => ({ ...prev, isProcessing: false }));
      }
    }
  };

  const cancelFileSelection = async () => {
    setSelectedFile(null);
    if (settings.isProcessing) {
      await audioEngine.close();
      // ファイルを解除したら自動的にライブ（デバイス入力）に戻る
      await startEngine(inputDeviceId, null);
    }
  };

  const handleProcessFile = async () => {
    if (!selectedFile) return;
    setIsProcessingFile(true);
    try {
      const blob = await audioEngine.renderOffline(selectedFile, settings);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `FX_${selectedFile.name.split('.')[0]}.wav`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert("レンダリング中にエラーが発生しました。");
    } finally {
      setIsProcessingFile(false);
    }
  };

  const copyConfigToClipboard = () => {
    const configStr = JSON.stringify(settings, null, 2);
    navigator.clipboard.writeText(configStr);
    setCopySuccess(true);
    setTimeout(() => setCopySuccess(false), 2000);
  };

  return (
    <div className="flex h-screen w-full flex-col md:flex-row overflow-hidden bg-[#0a0a0c]">
      {/* Sidebar */}
      <aside className="w-full md:w-80 h-[45vh] md:h-full p-5 border-b md:border-b-0 md:border-r border-white/10 flex flex-col gap-4 bg-black/40 backdrop-blur-md overflow-y-auto shrink-0 z-20 custom-scrollbar">
        <header className="flex justify-between items-center mb-1 shrink-0">
          <div className="flex flex-col">
            <h1 className="text-lg font-bold bg-gradient-to-r from-blue-400 to-indigo-500 bg-clip-text text-transparent">AudioFX</h1>
            <span className="text-[7px] text-slate-500 uppercase tracking-widest leading-none">Pro Reverb Engine</span>
          </div>
          <button 
            onClick={() => setShowConfig(true)} 
            className="text-[9px] bg-white/5 hover:bg-white/10 px-2 py-1 rounded text-indigo-400 border border-indigo-500/30 font-bold uppercase transition-all"
          >
            Config / Info
          </button>
        </header>

        <div className="space-y-4 pb-4">
          <div className="flex gap-2">
            <button 
              onClick={toggleProcessing} 
              disabled={isStarting}
              className={`flex-[2] py-3 rounded-xl text-xs font-bold transition-all shadow-lg ${isStarting ? 'opacity-50 cursor-wait' : ''} ${settings.isProcessing ? 'bg-red-500 text-white' : 'bg-blue-600 text-white shadow-blue-900/40'}`}
            >
              {isStarting ? 'INITIALIZING...' : (settings.isProcessing ? 'STOP' : (selectedFile ? 'PREVIEW FILE' : 'START LIVE'))}
            </button>
            <button 
              onClick={() => setSettings(s => ({...s, bypassEffects: !s.bypassEffects}))} 
              disabled={!settings.isProcessing}
              className={`flex-1 py-3 rounded-xl text-[10px] font-bold transition-all border ${!settings.isProcessing ? 'opacity-30' : ''} ${settings.bypassEffects ? 'bg-amber-500 border-amber-400 text-white' : 'bg-white/5 border-white/10 text-slate-400 hover:bg-white/10'}`}
            >
              BYPASS
            </button>
          </div>

          <div className="p-3 bg-white/5 rounded-xl border border-white/10 space-y-3">
            <h3 className="text-[9px] font-bold text-slate-500 uppercase tracking-widest flex justify-between items-center">
              <span>Device Routing</span>
              {settings.isProcessing && <div className="flex gap-1 h-2 items-center"><div className="w-1 h-full bg-green-500 rounded-full animate-pulse"></div><span className="text-[7px] text-green-500">ACTIVE</span></div>}
            </h3>
            <div className="space-y-2">
              <label className="text-[8px] text-slate-500 block uppercase">Input (Mic or BlackHole)</label>
              <select disabled={!!selectedFile} value={inputDeviceId} onChange={e => setInputDeviceId(e.target.value)} className="w-full bg-black border border-white/10 rounded-lg p-1.5 text-xs text-slate-200 outline-none focus:border-indigo-500/50">
                <option value="default">Default Device</option>
                {inputDevices.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || d.deviceId}</option>)}
              </select>
              <label className="text-[8px] text-slate-500 block uppercase pt-1">Output (Speakers)</label>
              <select value={outputDeviceId} onChange={e => setOutputDeviceId(e.target.value)} className="w-full bg-black border border-white/10 rounded-lg p-1.5 text-xs text-slate-200 outline-none focus:border-indigo-500/50">
                <option value="default">Default Output</option>
                {outputDevices.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || d.deviceId}</option>)}
              </select>
            </div>
          </div>

          <div className="p-3 bg-indigo-500/10 rounded-xl border border-indigo-500/30 space-y-3">
            <h3 className="text-[9px] font-bold text-indigo-400 uppercase tracking-widest">Offline Processor</h3>
            <div className="space-y-2">
              <input type="file" ref={fileInputRef} onChange={handleFileChange} accept="audio/*" className="hidden" />
              <div className="flex gap-2">
                {!selectedFile ? (
                  <button onClick={() => fileInputRef.current?.click()} className="flex-1 py-2 px-3 bg-black/40 border border-white/10 rounded-lg text-[10px] text-slate-300 hover:bg-white/10 transition-all text-left truncate">
                    Select Audio File...
                  </button>
                ) : (
                  <div className="flex-1 flex gap-1 overflow-hidden">
                    <div className="flex-1 py-2 px-3 bg-indigo-500/20 border border-indigo-500/40 rounded-lg text-[10px] text-indigo-200 truncate">
                      {selectedFile.name}
                    </div>
                    <button onClick={cancelFileSelection} className="px-3 bg-red-500/10 text-red-400 rounded-lg border border-red-500/20 hover:bg-red-500/20 font-bold" title="ファイルを解除してLIVEモードに戻る">×</button>
                  </div>
                )}
              </div>
              <button 
                onClick={handleProcessFile} 
                disabled={!selectedFile || isProcessingFile} 
                className={`w-full py-2.5 rounded-lg text-[10px] font-bold transition-all shadow-lg ${!selectedFile || isProcessingFile ? 'bg-white/5 text-slate-600 cursor-not-allowed' : 'bg-indigo-600 text-white hover:bg-indigo-500'}`}
              >
                {isProcessingFile ? "PROCESSING..." : "RENDER & DOWNLOAD"}
              </button>
            </div>
          </div>

          <div className="p-3 bg-white/5 rounded-xl border border-white/10 space-y-4">
            <h3 className="text-[9px] font-bold text-slate-500 uppercase tracking-widest text-center">Mixer</h3>
            <Slider label="Dry Mix" value={settings.wetPathDryGain} min={0} max={1.5} step={0.01} disabled={settings.bypassEffects} onChange={v => setSettings(s => ({...s, wetPathDryGain: v}))} colorClass="accent-slate-400" />
            <Slider label="Reverb Level" value={settings.wetGain} min={0} max={1.0} step={0.01} disabled={settings.bypassEffects} onChange={v => setSettings(s => ({...s, wetGain: v}))} colorClass="accent-indigo-500" />
            <Slider label="Bypass Gain" value={settings.bypassGain} min={0} max={1.5} step={0.01} disabled={!settings.bypassEffects} onChange={v => setSettings(s => ({...s, bypassGain: v}))} colorClass="accent-amber-500" />
          </div>

          <div className="p-3 bg-white/5 rounded-xl border border-white/10 space-y-4">
            <h3 className="text-[9px] font-bold text-slate-500 uppercase tracking-widest text-center">Reverb Engine</h3>
            <Slider label="RT60 (Time)" value={settings.reverbDuration} min={0.1} max={10} step={0.1} unit="s" disabled={settings.bypassEffects} onChange={v => setSettings(s => ({...s, reverbDuration: v}))} colorClass="accent-purple-500" />
            <Slider label="Damping" value={settings.reverbDecay} min={1} max={10} step={0.1} disabled={settings.bypassEffects} onChange={v => setSettings(s => ({...s, reverbDecay: v}))} colorClass="accent-purple-300" />
            <Slider label="Low Cut" value={settings.lowCut} min={20} max={2000} step={1} unit="Hz" disabled={settings.bypassEffects} onChange={v => setSettings(s => ({...s, lowCut: v}))} colorClass="accent-emerald-500" />
            <Slider label="High Cut" value={settings.highCut} min={500} max={20000} step={1} unit="Hz" disabled={settings.bypassEffects} onChange={v => setSettings(s => ({...s, highCut: v}))} colorClass="accent-rose-500" />
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 h-full flex flex-col overflow-hidden relative">
        <div className="flex-1 overflow-y-auto p-4 md:p-8 space-y-8 custom-scrollbar">
          <div className="h-[300px] md:h-[400px] flex flex-col shrink-0">
            <div className="flex justify-between items-center mb-3 px-2">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">Spectral Analysis</span>
            </div>
            <div className="flex-1 min-h-0">
              <Visualizer 
                analyserA={analysers.in} 
                analyserB={analysers.out} 
                colorA="#60a5fa" 
                colorB={settings.bypassEffects ? "#f59e0b" : "#818cf8"} 
                labelA="Input Source" 
                labelB={settings.bypassEffects ? "Output (Bypass)" : "Output (FX Mix)"}
              />
            </div>
          </div>

          <section className="bg-white/5 p-6 md:p-10 rounded-[2.5rem] border border-white/5 shadow-2xl">
            <h2 className="text-xl md:text-2xl font-bold mb-8">AI Room Simulator</h2>
            <div className="relative mb-8">
              <input 
                type="text" 
                value={aiInput}
                placeholder="例: タイル張りの広い浴室、狭いコンクリートの部屋、野外スタジアム..." 
                className={`w-full bg-black/50 border rounded-2xl px-5 py-4 focus:outline-none focus:ring-1 focus:ring-blue-500/50 text-sm text-white transition-all shadow-inner ${loadingPresets ? 'border-indigo-500/50' : 'border-white/10'}`}
                disabled={loadingPresets}
                onChange={e => setAiInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAiSubmit()}
              />
              {loadingPresets && (
                <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-2">
                  <span className="text-indigo-400 text-xs font-bold tracking-widest uppercase animate-pulse">Calculating...</span>
                </div>
              )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {aiPresets.map((p, i) => (
                <button 
                  key={i} 
                  onClick={() => applyPreset(p.settings)} 
                  className="text-left p-6 rounded-2xl bg-white/5 border border-white/5 hover:border-indigo-500/50 hover:bg-white/10 transition-all flex flex-col h-full shadow-lg"
                >
                  <h4 className="font-bold text-indigo-400 text-sm mb-1">{p.name}</h4>
                  <p className="text-[11px] text-slate-400 italic font-medium leading-snug">"{p.description}"</p>
                </button>
              ))}
            </div>
          </section>
        </div>
      </main>

      {/* Config Modal */}
      {showConfig && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="relative w-full max-w-2xl bg-[#121214] border border-white/10 rounded-[2rem] shadow-2xl p-6 md:p-10 max-h-[90vh] overflow-y-auto custom-scrollbar">
            <button onClick={() => setShowConfig(false)} className="absolute top-6 right-6 text-slate-500 hover:text-white"><svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>
            <h2 className="text-2xl font-bold mb-6">Configuration & Info</h2>

            <section className="mb-8 p-4 bg-red-500/10 border border-red-500/20 rounded-2xl">
              <h3 className="text-red-400 font-bold text-sm mb-2 uppercase tracking-widest">⚠️ スペアナが反応しない場合</h3>
              <p className="text-[11px] text-slate-300 leading-relaxed mb-3">
                BlackHoleをInputに選んでもスペアナが動かないときは、<b>Macのシステム全体の音</b>がBlackHoleに流れていない可能性があります。
              </p>
              <ol className="text-[10px] text-slate-400 space-y-1 list-decimal ml-4">
                <li>Macの「システム設定」&gt;「サウンド」を開く。</li>
                <li>「出力」タブで <b>BlackHole 2ch</b> を選択する。</li>
                <li>YouTube等で音を再生する。</li>
                <li>このアプリの「Input」で <b>BlackHole 2ch</b> を選択してSTARTを押す。</li>
              </ol>
            </section>

            <section className="mb-8">
              <h3 className="text-indigo-400 font-bold text-sm mb-3 uppercase tracking-widest">現在の設定値を書き出す</h3>
              <div className="bg-black rounded-xl p-4 border border-white/5 relative">
                <pre className="text-[10px] text-slate-400 font-mono overflow-x-auto">
                  {JSON.stringify(settings, null, 2)}
                </pre>
                <button 
                  onClick={copyConfigToClipboard} 
                  className="absolute top-3 right-3 py-1.5 px-3 bg-white/5 hover:bg-white/10 rounded-lg text-[10px] border border-white/10 transition-all text-indigo-300"
                >
                  {copySuccess ? 'COPIED!' : 'COPY CONFIG'}
                </button>
              </div>
              <p className="mt-3 text-[10px] text-slate-500 leading-relaxed italic">
                ※このJSONを保存しておけば、後で同じ設定を再現できます。
              </p>
            </section>

            <button onClick={() => setShowConfig(false)} className="w-full py-3 bg-indigo-600 rounded-xl text-xs font-bold text-white transition-all hover:bg-indigo-500 shadow-lg shadow-indigo-900/40">Close</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
