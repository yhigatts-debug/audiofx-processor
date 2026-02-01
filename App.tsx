
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
  
  const [loadingPresets, setLoadingPresets] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiPresets, setAiPresets] = useState<PresetSuggestion[]>([]);
  const [aiInput, setAiInput] = useState('');

  const [isStarting, setIsStarting] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isRecordingLive, setIsRecordingLive] = useState(false);
  const [autoMuted, setAutoMuted] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchDevices = useCallback(async () => {
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => {});
      const allDevices = await navigator.mediaDevices.enumerateDevices();
      setInputDevices(allDevices.filter(d => d.kind === 'audioinput'));
      setOutputDevices(allDevices.filter(d => d.kind === 'audiooutput'));
    } catch (e) { console.error("Failed to fetch devices", e); }
  }, []);

  useEffect(() => { fetchDevices(); }, [fetchDevices]);

  useEffect(() => {
    audioEngine.onAutoMuteTriggered = () => setAutoMuted(true);
  }, []);

  const startEngine = useCallback(async (forcedInputId?: string, file?: File | null) => {
    if (isStarting) return;
    setIsStarting(true);
    setAutoMuted(false);
    try {
      await audioEngine.init(
        forcedInputId || (inputDeviceId === 'default' ? undefined : inputDeviceId), 
        file || (selectedFile || undefined), 
        outputDeviceId === 'default' ? undefined : outputDeviceId
      );
      audioEngine.updateSettings(settings);
      setAnalysers({ in: audioEngine.analyserInput, out: audioEngine.analyserOutput });
      setSettings(prev => ({ ...prev, isProcessing: true }));
    } catch (err: any) {
      console.error(err);
    } finally {
      setIsStarting(false);
    }
  }, [inputDeviceId, outputDeviceId, selectedFile, isStarting, settings]);

  const toggleProcessing = async () => {
    if (isStarting) return;
    setAutoMuted(false);
    if (!settings.isProcessing) {
      await startEngine(undefined, selectedFile);
    } else {
      await audioEngine.close();
      setAnalysers({ in: null, out: null });
      setSettings(prev => ({ ...prev, isProcessing: false }));
      setIsRecordingLive(false);
    }
  };

  const handleRecord = async () => {
    if (!isRecordingLive) {
      audioEngine.startRecording();
      setIsRecordingLive(true);
    } else {
      const blob = await audioEngine.stopRecording();
      setIsRecordingLive(false);
      if (blob) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `recording-${Date.now()}.webm`;
        a.click();
      }
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      if (settings.isProcessing) toggleProcessing();
    }
  };

  const resetFile = () => {
    setSelectedFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (settings.isProcessing) {
      // ファイルを解除した後はマイク入力に切り替えるため一度エンジンを止める
      toggleProcessing();
    }
  };

  useEffect(() => {
    if (settings.isProcessing) {
      audioEngine.updateSettings(settings);
    }
  }, [settings]);

  const handleAiSubmit = async () => {
    const value = aiInput.trim();
    if (!value || loadingPresets) return;
    setLoadingPresets(true);
    setAiError(null);
    try {
      const presets = await getGeminiPresets(value);
      setAiPresets(presets);
      setAiInput(''); 
    } catch (err: any) {
      setAiError(err.message);
    } finally {
      setLoadingPresets(false);
    }
  };

  return (
    <div className="flex h-screen w-full flex-col md:flex-row overflow-hidden bg-[#0a0a0c]">
      <aside className="w-full md:w-80 h-[45vh] md:h-full p-5 border-b md:border-b-0 md:border-r border-white/10 flex flex-col gap-4 bg-black/40 backdrop-blur-md overflow-y-auto shrink-0 z-20 custom-scrollbar">
        <header className="flex justify-between items-center mb-1 shrink-0">
          <div className="flex flex-col">
            <h1 className="text-lg font-bold bg-gradient-to-r from-blue-400 to-indigo-500 bg-clip-text text-transparent">AudioFX</h1>
            <span className="text-[7px] text-slate-500 uppercase tracking-widest leading-none">Pro Reverb Engine</span>
          </div>
        </header>

        <div className="space-y-4 pb-4">
          <div className="flex flex-col gap-2">
            <button 
              onClick={toggleProcessing} 
              disabled={isStarting}
              className={`w-full py-3 rounded-xl text-xs font-bold transition-all shadow-lg ${settings.isProcessing ? 'bg-red-500 text-white' : 'bg-blue-600 text-white'}`}
            >
              {isStarting ? '...' : (settings.isProcessing ? 'STOP ENGINE' : 'START ENGINE')}
            </button>
            
            <button 
              onClick={handleRecord}
              disabled={!settings.isProcessing}
              className={`w-full py-2 rounded-lg text-[9px] font-bold border transition-all ${isRecordingLive ? 'bg-red-600 border-red-400 text-white animate-pulse' : 'bg-white/5 border-white/10 text-slate-400 disabled:opacity-30'}`}
            >
              {isRecordingLive ? 'STOP RECORDING' : 'RECORD OUTPUT'}
            </button>
          </div>

          <div className="space-y-1">
            <div className="grid grid-cols-2 gap-2">
              <div className="relative group col-span-1">
                <button 
                  onClick={() => fileInputRef.current?.click()}
                  className={`w-full py-2 rounded-lg text-[9px] font-bold border transition-all ${selectedFile ? 'bg-indigo-600 border-indigo-400 text-white' : 'bg-white/5 border-white/10 text-slate-400'}`}
                >
                  {selectedFile ? 'CHANGE FILE' : 'CHOOSE FILE'}
                </button>
                {selectedFile && (
                  <button 
                    onClick={(e) => { e.stopPropagation(); resetFile(); }}
                    className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full w-4 h-4 flex items-center justify-center text-[8px] hover:bg-red-600 shadow-md z-30"
                    title="ファイルを解除してマイクに戻す"
                  >
                    ✕
                  </button>
                )}
              </div>
              <button 
                onClick={() => setSettings(s => ({...s, bypassEffects: !s.bypassEffects}))} 
                disabled={!settings.isProcessing}
                className={`py-2 rounded-lg text-[9px] font-bold border transition-all ${settings.bypassEffects ? 'bg-amber-500 text-white border-amber-400' : 'bg-white/5 border-white/10 text-slate-400'}`}
              >
                BYPASS FX
              </button>
            </div>
            {selectedFile && (
              <div className="text-[8px] text-indigo-300 truncate mt-1 px-1 bg-indigo-500/10 py-1 rounded">
                📄 {selectedFile.name}
              </div>
            )}
          </div>
          <input type="file" ref={fileInputRef} onChange={handleFileChange} accept="audio/*" className="hidden" />

          <div className="p-3 bg-white/5 rounded-xl border border-white/10 space-y-3">
            <h3 className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Routing</h3>
            <select value={inputDeviceId} onChange={e => setInputDeviceId(e.target.value)} className="w-full bg-black border border-white/10 rounded-lg p-1.5 text-[10px] text-slate-200 outline-none">
              <option value="default">Default Input (Mic)</option>
              {inputDevices.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || d.deviceId}</option>)}
            </select>
            <select value={outputDeviceId} onChange={e => setOutputDeviceId(e.target.value)} className="w-full bg-black border border-white/10 rounded-lg p-1.5 text-[10px] text-slate-200 outline-none">
              <option value="default">Default Output</option>
              {outputDevices.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || d.deviceId}</option>)}
            </select>
          </div>

          <div className="p-3 bg-white/5 rounded-xl border border-white/10 space-y-4">
            <h3 className="text-[9px] font-bold text-slate-500 uppercase tracking-widest text-center">Mixer</h3>
            <Slider label="Dry" value={settings.wetPathDryGain} min={0} max={1.5} step={0.01} onChange={v => setSettings(s => ({...s, wetPathDryGain: v}))} thumbColor="#94a3b8" />
            <Slider label="Wet" value={settings.wetGain} min={0} max={1.0} step={0.01} onChange={v => setSettings(s => ({...s, wetGain: v}))} thumbColor="#818cf8" />
            <Slider label="Master" value={settings.masterGain} min={0} max={1.5} step={0.01} onChange={v => setSettings(s => ({...s, masterGain: v}))} thumbColor="#f59e0b" />
          </div>

          <div className="p-3 bg-white/5 rounded-xl border border-white/10 space-y-4">
            <h3 className="text-[9px] font-bold text-slate-500 uppercase tracking-widest text-center">Acoustics</h3>
            <Slider label="Decay" value={settings.reverbDuration} min={0.1} max={10} step={0.1} unit="s" onChange={v => setSettings(s => ({...s, reverbDuration: v}))} thumbColor="#a855f7" />
            <Slider label="Damping" value={settings.reverbDecay} min={1} max={10} step={0.1} onChange={v => setSettings(s => ({...s, reverbDecay: v}))} thumbColor="#ec4899" />
            <Slider label="Pre-Delay" value={settings.reverbPreDelay} min={0} max={1.0} step={0.001} unit="s" onChange={v => setSettings(s => ({...s, reverbPreDelay: v}))} thumbColor="#38bdf8" />
          </div>

          <div className="p-3 bg-white/5 rounded-xl border border-white/10 space-y-4">
            <h3 className="text-[9px] font-bold text-slate-500 uppercase tracking-widest text-center">EQ</h3>
            <Slider label="Low Cut" value={settings.lowCut} min={20} max={2000} step={1} unit="Hz" onChange={v => setSettings(s => ({...s, lowCut: v}))} thumbColor="#10b981" />
            <Slider label="High Cut" value={settings.highCut} min={500} max={20000} step={1} unit="Hz" onChange={v => setSettings(s => ({...s, highCut: v}))} thumbColor="#f43f5e" />
          </div>
        </div>
      </aside>

      <main className="flex-1 h-full flex flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto p-4 md:p-8 space-y-8 custom-scrollbar">
          <div className="h-[300px] md:h-[450px]">
            <Visualizer 
              analyserA={analysers.in} 
              analyserB={analysers.out} 
              colorA="#60a5fa" 
              colorB={settings.bypassEffects ? "#f59e0b" : "#818cf8"} 
              labelA="INPUT" 
              labelB={settings.bypassEffects ? "BYPASS" : "WET OUTPUT"}
            />
          </div>

          <section className="bg-white/5 p-6 md:p-10 rounded-[2.5rem] border border-white/5">
            <h2 className="text-xl md:text-2xl font-bold mb-6 italic">Acoustic Architect</h2>
            <div className="flex gap-2">
              <input 
                type="text" 
                value={aiInput}
                placeholder="場所や音響特性を入力..." 
                className="flex-1 bg-black/50 border border-white/10 rounded-2xl px-5 py-4 text-sm outline-none"
                disabled={loadingPresets}
                onChange={e => setAiInput(e.target.value)}
              />
              <button onClick={handleAiSubmit} disabled={loadingPresets || !aiInput.trim()} className="px-8 bg-indigo-600 rounded-2xl text-xs font-bold transition-all min-w-[120px]">
                GENERATE
              </button>
            </div>
            {aiError && <p className="text-[10px] text-red-400 mt-2 ml-2 italic">{aiError}</p>}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-8">
              {aiPresets.map((p, i) => (
                <button key={i} onClick={() => setSettings(s => ({...s, ...p.settings, bypassEffects: false}))} className="text-left p-6 rounded-3xl bg-white/5 border border-white/5 hover:border-indigo-500/50 transition-all">
                  <h4 className="font-bold text-indigo-400 text-sm mb-1">{p.name}</h4>
                  <p className="text-[10px] text-slate-400 leading-relaxed italic">"{p.description}"</p>
                </button>
              ))}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
};

export default App;
