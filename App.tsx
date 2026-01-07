
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
  const isInternalUpdate = useRef(false);

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

  const startEngine = useCallback(async (forcedInputId?: string, file?: File | null) => {
    if (isStarting) return;
    setIsStarting(true);
    try {
      await audioEngine.init(
        forcedInputId || (inputDeviceId === 'default' ? undefined : inputDeviceId),
        file || (selectedFile || undefined),
        outputDeviceId === 'default' ? undefined : outputDeviceId
      );
      audioEngine.updateSettings(settings);
      setAnalysers({ in: audioEngine.analyserInput, out: audioEngine.analyserOutput });
      setSettings(prev => ({ ...prev, isProcessing: true }));
    } catch (err) {
      console.error(err);
    } finally {
      setIsStarting(false);
    }
  }, [inputDeviceId, outputDeviceId, selectedFile, settings, isStarting]);

  const toggleProcessing = async () => {
    if (isStarting) return;
    if (!settings.isProcessing) {
      await startEngine(undefined, selectedFile);
    } else {
      await audioEngine.close();
      setAnalysers({ in: null, out: null });
      setSettings(prev => ({ ...prev, isProcessing: false }));
    }
  };

  // デバイス変更時の自動再起動（依存関係を整理してループを防止）
  useEffect(() => {
    if (settings.isProcessing && !isStarting) {
      const timer = setTimeout(() => {
        startEngine();
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [inputDeviceId, outputDeviceId]);

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
        audioEngine.close().then(() => {
          setAnalysers({ in: null, out: null });
          setSettings(prev => ({ ...prev, isProcessing: false }));
        });
      }
    }
  };

  const cancelFileSelection = async () => {
    setSelectedFile(null);
    if (settings.isProcessing) {
      await audioEngine.close();
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
      <aside className="w-full md:w-80 h-[45vh] md:h-full p-5 border-b md:border-b-0 md:border-r border-white/10 flex flex-col gap-4 bg-black/40 backdrop-blur-md overflow-y-auto shrink-0 z-20 custom-scrollbar">
        <header className="flex justify-between items-center mb-1 shrink-0">
          <div className="flex flex-col">
            <h1 className="text-lg font-bold bg-gradient-to-r from-blue-400 to-indigo-500 bg-clip-text text-transparent">AudioFX</h1>
            <span className="text-[7px] text-slate-500 uppercase tracking-widest leading-none">Pro Reverb Engine</span>
          </div>
          <button onClick={() => setShowConfig(true)} className="text-[9px] bg-white/5 hover:bg-white/10 px-2 py-1 rounded text-indigo-400 border border-indigo-500/30 font-bold uppercase">Config</button>
        </header>

        <div className="space-y-4 pb-4">
          <div className="flex gap-2">
            <button 
              onClick={toggleProcessing} 
              disabled={isStarting}
              className={`flex-[2] py-3 rounded-xl text-xs font-bold transition-all shadow-lg ${settings.isProcessing ? 'bg-red-500 text-white' : 'bg-blue-600 text-white'}`}
            >
              {isStarting ? '...' : (settings.isProcessing ? 'STOP' : (selectedFile ? 'PREVIEW FILE' : 'START LIVE'))}
            </button>
            <button 
              onClick={() => setSettings(s => ({...s, bypassEffects: !s.bypassEffects}))} 
              disabled={!settings.isProcessing}
              className={`flex-1 py-3 rounded-xl text-[10px] font-bold border ${settings.bypassEffects ? 'bg-amber-500 text-white' : 'bg-white/5 text-slate-400'}`}
            >
              BYPASS
            </button>
          </div>

          <div className="p-3 bg-white/5 rounded-xl border border-white/10 space-y-3">
            <h3 className="text-[9px] font-bold text-slate-500 uppercase tracking-widest flex justify-between">Routing</h3>
            <div className="space-y-2">
              <label className="text-[8px] text-slate-500 block">INPUT</label>
              <select disabled={!!selectedFile} value={inputDeviceId} onChange={e => setInputDeviceId(e.target.value)} className="w-full bg-black border border-white/10 rounded-lg p-1.5 text-xs text-slate-200">
                <option value="default">Default</option>
                {inputDevices.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || d.deviceId}</option>)}
              </select>
              <label className="text-[8px] text-slate-500 block">OUTPUT</label>
              <select value={outputDeviceId} onChange={e => setOutputDeviceId(e.target.value)} className="w-full bg-black border border-white/10 rounded-lg p-1.5 text-xs text-slate-200">
                <option value="default">Default</option>
                {outputDevices.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || d.deviceId}</option>)}
              </select>
            </div>
          </div>

          <div className="p-3 bg-indigo-500/10 rounded-xl border border-indigo-500/30 space-y-3">
            <h3 className="text-[9px] font-bold text-indigo-400 uppercase tracking-widest">File</h3>
            <div className="space-y-2">
              <input type="file" ref={fileInputRef} onChange={handleFileChange} accept="audio/*" className="hidden" />
              <div className="flex gap-2">
                {!selectedFile ? (
                  <button onClick={() => fileInputRef.current?.click()} className="flex-1 py-2 px-3 bg-black/40 border border-white/10 rounded-lg text-[10px] text-slate-300 truncate">Select...</button>
                ) : (
                  <div className="flex-1 flex gap-1 overflow-hidden">
                    <div className="flex-1 py-2 px-3 bg-indigo-500/20 border border-indigo-500/40 rounded-lg text-[10px] text-indigo-200 truncate">{selectedFile.name}</div>
                    <button onClick={cancelFileSelection} className="px-3 bg-red-500/10 text-red-400 rounded-lg border border-red-500/20 font-bold">×</button>
                  </div>
                )}
              </div>
              <button onClick={handleProcessFile} disabled={!selectedFile || isProcessingFile} className="w-full py-2 bg-indigo-600 text-white rounded-lg text-[10px] font-bold">RENDER</button>
            </div>
          </div>

          <div className="p-3 bg-white/5 rounded-xl border border-white/10 space-y-4">
            <Slider label="Dry Mix" value={settings.wetPathDryGain} min={0} max={1.5} step={0.01} onChange={v => setSettings(s => ({...s, wetPathDryGain: v}))} />
            <Slider label="Reverb" value={settings.wetGain} min={0} max={1.0} step={0.01} onChange={v => setSettings(s => ({...s, wetGain: v}))} />
            <Slider label="Time" value={settings.reverbDuration} min={0.1} max={10} step={0.1} unit="s" onChange={v => setSettings(s => ({...s, reverbDuration: v}))} />
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
              labelA="Input" 
              labelB="Output"
            />
          </div>

          <section className="bg-white/5 p-6 rounded-[2rem] border border-white/5">
            <h2 className="text-xl font-bold mb-6">AI Room Simulator</h2>
            <div className="flex gap-2 mb-6">
              <input 
                type="text" 
                value={aiInput}
                placeholder="場所の説明を入力..." 
                className="flex-1 bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-sm"
                disabled={loadingPresets}
                onChange={e => setAiInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAiSubmit()}
              />
              <button onClick={handleAiSubmit} disabled={loadingPresets} className="px-6 bg-indigo-600 rounded-xl text-xs font-bold">{loadingPresets ? '...' : 'GENERATE'}</button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {aiPresets.map((p, i) => (
                <button key={i} onClick={() => applyPreset(p.settings)} className="text-left p-4 rounded-xl bg-white/5 border border-white/5 hover:border-indigo-500/50">
                  <h4 className="font-bold text-indigo-400 text-xs mb-1">{p.name}</h4>
                  <p className="text-[10px] text-slate-400">"{p.description}"</p>
                </button>
              ))}
            </div>
          </section>
        </div>
      </main>

      {showConfig && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md text-white">
          <div className="bg-[#121214] border border-white/10 rounded-[2rem] p-8 max-w-lg w-full">
            <h2 className="text-xl font-bold mb-4">Setup Info</h2>
            <p className="text-xs text-slate-400 mb-4 leading-relaxed">
              Mac全体の音を加工するには <b>BlackHole 2ch</b> 等の仮想オーディオデバイスが必要です。
              システム出力をBlackHoleに設定し、本アプリのInputでBlackHoleを選択してください。
            </p>
            <button onClick={() => setShowConfig(false)} className="w-full py-3 bg-indigo-600 rounded-xl font-bold">Close</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
