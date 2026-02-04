
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { audioEngine } from './services/audioEngine';
import { getGeminiPresets } from './services/geminiService';
import { AudioSettings, PresetSuggestion } from './types';
import Visualizer from './components/Visualizer';

const ALGO_COLORS = { lexicon: '#60a5fa', bricasti: '#fbbf24', tcelectronic: '#10b981' };

const Slider: React.FC<{
  label: string, value: number, min: number, max: number, step: number, unit?: string,
  disabled?: boolean, onChange: (v: number) => void, thumbColor: string
}> = ({ label, value, min, max, step, unit = '', disabled, onChange, thumbColor }) => (
  <div className={`space-y-1 ${disabled ? 'opacity-20 pointer-events-none' : ''}`}>
    <div className="flex justify-between text-[10px] text-slate-400">
      <span>{label}</span>
      <span className="font-mono text-slate-200">{value.toFixed(step >= 1 ? 0 : 3)}{unit}</span>
    </div>
    <input type="range" min={min} max={max} step={step} value={value} disabled={disabled}
      onChange={e => onChange(parseFloat(e.target.value))} className="w-full slider-input"
      style={{ '--thumb-color': thumbColor } as React.CSSProperties} />
  </div>
);

const App: React.FC = () => {
  const [settings, setSettings] = useState<AudioSettings>({
    wetPathDryGain: 1.0, wetGain: 0.6,
    reverbDuration: 2.4, reverbPreDelay: 0.03,
    lowCut: 250, highCut: 14000, masterGain: 1.0, algoMode: 'lexicon',
    lexSpin: 0.6, lexWander: 0.4, lexBassMult: 1.0,
    briDensity: 0.75, briSize: 1.0, briVRoll: 6000,
    tcAir: 0.5, tcEarlyLate: 0.4, tcHiDamp: 0.6,
    isProcessing: false, bypassEffects: false
  });

  const [inputDevices, setInputDevices] = useState<MediaDeviceInfo[]>([]);
  const [outputDevices, setOutputDevices] = useState<MediaDeviceInfo[]>([]);
  const [inputDeviceId, setInputDeviceId] = useState('default');
  const [outputDeviceId, setOutputDeviceId] = useState('default');
  const [analysers, setAnalysers] = useState<{in: AnalyserNode | null, out: AnalyserNode | null}>({in: null, out: null});
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [isRendering, setIsRendering] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [aiInput, setAiInput] = useState('');
  const [aiPresets, setAiPresets] = useState<PresetSuggestion[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const bypassSavedSettings = useRef<{ dry: number, wet: number } | null>(null);

  useEffect(() => {
    navigator.mediaDevices.enumerateDevices().then(devices => {
      setInputDevices(devices.filter(d => d.kind === 'audioinput'));
      setOutputDevices(devices.filter(d => d.kind === 'audiooutput'));
    });
  }, []);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.name.endsWith('.json')) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const s = JSON.parse(ev.target?.result as string);
          setSettings(prev => ({ ...prev, ...s, isProcessing: false, bypassEffects: false }));
        } catch (e) { alert("Invalid Preset JSON"); }
      };
      reader.readAsText(file);
      return;
    }
    setSelectedFile(file);
    if (settings.isProcessing) toggleEngine();
  };

  const toggleEngine = async () => {
    if (settings.isProcessing) {
      if (isRecording) await handleToggleRecording();
      await audioEngine.close();
      setSettings(s => ({...s, isProcessing: false}));
      setAnalysers({in: null, out: null});
    } else {
      setLoading(true);
      try {
        await audioEngine.init(
          selectedFile ? undefined : (inputDeviceId === 'default' ? undefined : inputDeviceId),
          selectedFile || undefined,
          outputDeviceId === 'default' ? undefined : outputDeviceId
        );
        audioEngine.updateSettings(settings);
        setAnalysers({in: audioEngine.analyserInput, out: audioEngine.analyserOutput});
        setSettings(s => ({...s, isProcessing: true}));
      } catch (e) { alert("Engine Start Failed"); } finally { setLoading(false); }
    }
  };

  const handleToggleRecording = async () => {
    if (isRecording) {
      const blob = await audioEngine.stopRecording();
      const now = new Date();
      const timestamp = now.getFullYear() +
        (now.getMonth() + 1).toString().padStart(2, '0') +
        now.getDate().toString().padStart(2, '0') + "_" +
        now.getHours().toString().padStart(2, '0') +
        now.getMinutes().toString().padStart(2, '0') +
        now.getSeconds().toString().padStart(2, '0');
      
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `AudioFX_Record_${timestamp}.webm`;
      a.click();
      setIsRecording(false);
    } else {
      audioEngine.startRecording();
      setIsRecording(true);
    }
  };

  const toggleBypass = () => {
    setSettings(prev => {
      const willBypass = !prev.bypassEffects;
      if (willBypass) {
        bypassSavedSettings.current = { dry: prev.wetPathDryGain, wet: prev.wetGain };
        return { ...prev, bypassEffects: true, wetPathDryGain: 1.0, wetGain: 0.0 };
      } else {
        const saved = bypassSavedSettings.current || { dry: 1.0, wet: 0.6 };
        return { ...prev, bypassEffects: false, wetPathDryGain: saved.dry, wetGain: saved.wet };
      }
    });
  };

  const handleOfflineRender = async () => {
    if (!selectedFile) return;
    setIsRendering(true);
    try {
      const wavBlob = await audioEngine.renderOffline(selectedFile, settings);
      const url = URL.createObjectURL(wavBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Processed_${selectedFile.name.split('.')[0]}.wav`;
      a.click();
      
      const settingsBlob = new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' });
      const settingsUrl = URL.createObjectURL(settingsBlob);
      const aSet = document.createElement('a');
      aSet.href = settingsUrl;
      aSet.download = `Preset_${selectedFile.name.split('.')[0]}.json`;
      aSet.click();
    } catch (e) { alert("Rendering Failed"); } finally { setIsRendering(false); }
  };

  const generateAIPresets = useCallback(async () => {
    if (!aiInput || isGenerating) return;
    setIsGenerating(true);
    try {
      const presets = await getGeminiPresets(aiInput);
      setAiPresets(presets);
    } catch (e) {
      alert(e instanceof Error ? e.message : "AI generation failed");
    } finally {
      setIsGenerating(false);
    }
  }, [aiInput, isGenerating]);

  useEffect(() => { if (settings.isProcessing) audioEngine.updateSettings(settings); }, [settings]);

  const renderAlgoSpecificControls = () => {
    const color = ALGO_COLORS[settings.algoMode];
    switch (settings.algoMode) {
      case 'lexicon':
        return (
          <>
            <Slider label="Spin (Speed)" value={settings.lexSpin} min={0} max={2.0} step={0.01} onChange={v => setSettings(s => ({...s, lexSpin: v}))} thumbColor={color} />
            <Slider label="Wander (Depth)" value={settings.lexWander} min={0} max={1.0} step={0.01} onChange={v => setSettings(s => ({...s, lexWander: v}))} thumbColor={color} />
            <Slider label="Bass Multiplier" value={settings.lexBassMult} min={0.5} max={2.0} step={0.01} onChange={v => setSettings(s => ({...s, lexBassMult: v}))} thumbColor={color} />
          </>
        );
      case 'bricasti':
        return (
          <>
            <Slider label="Density" value={settings.briDensity} min={0} max={1.0} step={0.01} onChange={v => setSettings(s => ({...s, briDensity: v}))} thumbColor={color} />
            <Slider label="Room Size" value={settings.briSize} min={0.1} max={5.0} step={0.01} onChange={v => setSettings(s => ({...s, briSize: v}))} thumbColor={color} />
            <Slider label="V-Roll (Hz)" value={settings.briVRoll} min={1000} max={20000} step={10} onChange={v => setSettings(s => ({...s, briVRoll: v}))} thumbColor={color} />
          </>
        );
      case 'tcelectronic':
        return (
          <>
            <Slider label="Air Quality" value={settings.tcAir} min={0} max={1.0} step={0.01} onChange={v => setSettings(s => ({...s, tcAir: v}))} thumbColor={color} />
            <Slider label="ER / Tail Balance" value={settings.tcEarlyLate} min={0} max={1.0} step={0.01} onChange={v => setSettings(s => ({...s, tcEarlyLate: v}))} thumbColor={color} />
            <Slider label="Hi-Damping" value={settings.tcHiDamp} min={0} max={1.0} step={0.01} onChange={v => setSettings(s => ({...s, tcHiDamp: v}))} thumbColor={color} />
          </>
        );
    }
  };

  return (
    <div className="flex h-screen w-full bg-[#0a0a0c] text-slate-100 font-sans overflow-hidden">
      <aside className="w-80 border-r border-white/10 p-6 flex flex-col gap-6 bg-black/40 overflow-y-auto custom-scrollbar">
        <header>
          <h1 className="text-2xl font-black italic bg-gradient-to-r from-blue-400 to-emerald-400 bg-clip-text text-transparent">AudioFX ELITE</h1>
          <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold">Studio Master V2.5</p>
        </header>

        <div className="space-y-2">
          <button onClick={toggleEngine} disabled={loading} className={`w-full py-4 rounded-xl text-xs font-black transition-all ${settings.isProcessing ? 'bg-red-500 hover:bg-red-600' : 'bg-blue-600 hover:bg-blue-500'}`}>
            {loading ? 'WAIT...' : (settings.isProcessing ? 'STOP ENGINE' : 'START ENGINE')}
          </button>
          
          {settings.isProcessing && (
            <button onClick={handleToggleRecording} className={`w-full py-4 rounded-xl text-xs font-black transition-all border-2 ${isRecording ? 'bg-red-600 border-red-500 animate-pulse' : 'bg-white/5 border-white/10 hover:bg-white/10'}`}>
              {isRecording ? 'STOP RECORDING' : 'RECORD OUTPUT'}
            </button>
          )}
          
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => fileInputRef.current?.click()} className="py-2 bg-white/5 border border-white/10 rounded-lg text-[10px] font-black hover:bg-white/10 transition-all uppercase tracking-tighter">Choose File</button>
            <button onClick={toggleBypass} className={`py-2 rounded-lg text-[10px] font-black border-2 transition-all uppercase tracking-tighter ${settings.bypassEffects ? 'bg-orange-500 border-orange-400 text-white' : 'bg-transparent border-white/10 text-slate-500'}`}>
              {settings.bypassEffects ? 'Bypass On' : 'Bypass FX'}
            </button>
          </div>
        </div>

        {selectedFile && (
          <button onClick={handleOfflineRender} disabled={isRendering} className={`w-full py-4 rounded-xl text-[11px] font-black flex items-center justify-center gap-3 border-2 border-emerald-500/50 text-emerald-400 hover:bg-emerald-500/20 transition-all ${isRendering ? 'animate-pulse' : ''}`}>
            {isRendering ? 'RENDERING...' : 'RENDER & DOWNLOAD WAV'}
          </button>
        )}

        <div className="p-4 bg-white/5 rounded-2xl border border-white/10 space-y-4">
          <h3 className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Routing</h3>
          <div className="space-y-2">
            {selectedFile ? (
               <div className="bg-indigo-500/20 border border-indigo-500/30 rounded-lg p-2 text-[10px] text-indigo-300 flex justify-between items-center">
                 <span className="truncate flex-1">📄 {selectedFile.name}</span>
                 <button onClick={() => setSelectedFile(null)} className="text-red-400 font-bold ml-2 px-2 hover:bg-red-500/20 rounded">×</button>
               </div>
            ) : (
              <select value={inputDeviceId} onChange={e => setInputDeviceId(e.target.value)} className="w-full bg-black/60 border border-white/10 rounded-lg p-2 text-[10px] outline-none">
                <option value="default">🎤 Default Input</option>
                {inputDevices.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label}</option>)}
              </select>
            )}
            <select value={outputDeviceId} onChange={e => setOutputDeviceId(e.target.value)} className="w-full bg-black/60 border border-white/10 rounded-lg p-2 text-[10px] outline-none">
              <option value="default">🔈 System Output</option>
              {outputDevices.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label}</option>)}
            </select>
            <input type="file" ref={fileInputRef} hidden accept="audio/*,.json" onChange={handleFileChange} />
          </div>
        </div>

        <div className="p-4 bg-white/5 rounded-2xl border border-white/10 space-y-4">
          <h3 className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Mastering</h3>
          <Slider label="Master Out" value={settings.masterGain} min={0} max={2.0} step={0.01} onChange={v => setSettings(s => ({...s, masterGain: v}))} thumbColor="#f59e0b" />
          <Slider label="Dry Mix" value={settings.wetPathDryGain} min={0} max={1.0} step={0.01} onChange={v => setSettings(s => ({...s, wetPathDryGain: v, bypassEffects: false}))} thumbColor="#fff" />
          <Slider label="Wet Gain" value={settings.wetGain} min={0} max={1.5} step={0.01} onChange={v => setSettings(s => ({...s, wetGain: v, bypassEffects: false}))} thumbColor={ALGO_COLORS[settings.algoMode]} />
          
          <div className="mt-4 pt-4 border-t border-white/5 flex justify-center">
              <button onClick={() => {
                 const blob = new Blob([JSON.stringify(settings, null, 2)], {type: 'application/json'});
                 const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'preset.json'; a.click();
              }} className="w-full py-2 bg-white/5 border border-white/10 rounded-lg text-[9px] font-black hover:bg-white/10 uppercase tracking-tighter">Save Current Preset</button>
          </div>
        </div>

        <div className="p-4 bg-white/5 rounded-2xl border border-white/10 space-y-4">
          <h3 className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Acoustics</h3>
          <Slider label="RT60 (Time)" value={settings.reverbDuration} min={0.1} max={10} step={0.1} unit="s" onChange={v => setSettings(s => ({...s, reverbDuration: v}))} thumbColor="#fff" />
          <Slider label="Pre-Delay" value={settings.reverbPreDelay} min={0} max={0.3} step={0.001} unit="s" onChange={v => setSettings(s => ({...s, reverbPreDelay: v}))} thumbColor="#fff" />
        </div>

        <div className="p-4 bg-white/5 rounded-2xl border-l-4 space-y-4" style={{ borderLeftColor: ALGO_COLORS[settings.algoMode] }}>
          <h3 className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Engine Specifics</h3>
          {renderAlgoSpecificControls()}
        </div>

        <div className="p-4 bg-white/5 rounded-2xl border border-white/10 space-y-4 mb-10">
          <h3 className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">EQ Filters</h3>
          <Slider label="Low Cut" value={settings.lowCut} min={20} max={1000} step={1} unit="Hz" onChange={v => setSettings(s => ({...s, lowCut: v}))} thumbColor="#4ade80" />
          <Slider label="High Cut" value={settings.highCut} min={1000} max={20000} step={1} unit="Hz" onChange={v => setSettings(s => ({...s, highCut: v}))} thumbColor="#fb7185" />
        </div>
      </aside>

      <main className="flex-1 p-8 flex flex-col gap-8 overflow-y-auto custom-scrollbar">
        <div className="h-80 shrink-0">
          <Visualizer analyserA={analysers.in} analyserB={analysers.out} colorA="#94a3b8" colorB={ALGO_COLORS[settings.algoMode]} labelA="SOURCE" labelB="PROCESSED" />
        </div>

        <div className="bg-white/5 p-8 rounded-[3rem] border border-white/10 shadow-2xl">
          <div className="flex justify-between items-end mb-6">
            <h2 className="text-xl font-black italic uppercase tracking-tighter">Algorithm Topology</h2>
            <div className="text-[10px] text-slate-500 font-mono">STABLE ENGINE V2.5</div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            {(['lexicon', 'bricasti', 'tcelectronic'] as const).map(m => (
              <button key={m} onClick={() => setSettings(s => ({...s, algoMode: m}))}
                className={`py-8 rounded-3xl border-2 transition-all uppercase text-[11px] font-black flex flex-col items-center gap-2 ${settings.algoMode === m ? 'bg-white/10 border-current shadow-xl scale-[1.02]' : 'bg-transparent border-white/5 text-slate-600'}`}
                style={{ color: settings.algoMode === m ? ALGO_COLORS[m] : 'inherit', borderColor: settings.algoMode === m ? ALGO_COLORS[m] : 'transparent' }}>
                <span className="text-xs">{m.toUpperCase()}</span>
                <span className="text-[8px] opacity-60 font-normal">{m === 'lexicon' ? 'Rich FDN' : m === 'bricasti' ? 'Dense Schroeder' : 'Advanced FDN8'}</span>
              </button>
            ))}
          </div>
        </div>

        <section className="bg-gradient-to-br from-indigo-950/40 to-black p-8 rounded-[3rem] border border-white/10 mb-10 shadow-2xl">
          <div className="flex items-center gap-3 mb-6">
            <h2 className="text-xl font-black italic">Acoustic AI</h2>
            <span className="px-2 py-0.5 bg-indigo-500 rounded-full text-[9px] font-bold tracking-widest">GEMINI PRO</span>
          </div>
          <div className="flex gap-2 mb-6">
            <input type="text" value={aiInput} onChange={(e) => setAiInput(e.target.value)} placeholder="例: 広大な大聖堂、80年代のドラムルーム、小さな石造りの部屋..." className="flex-1 bg-black/50 border border-white/10 rounded-2xl px-6 py-4 text-xs outline-none focus:border-indigo-500 transition-all" />
            <button onClick={generateAIPresets} disabled={isGenerating || !aiInput} className="px-8 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-30 rounded-2xl text-[11px] font-black transition-all shadow-lg shadow-indigo-600/20">
              {isGenerating ? 'ANALYZING...' : 'DESIGN'}
            </button>
          </div>
          <div className="grid grid-cols-3 gap-3">
             {aiPresets.map((p, i) => (
               <button key={i} onClick={() => setSettings(s => ({...s, ...p.settings, bypassEffects: false}))} className="p-4 text-left bg-white/5 border border-white/5 rounded-xl hover:bg-white/10 transition-all border hover:border-indigo-500/30">
                 <h4 className="text-[10px] font-black text-indigo-400 mb-1 uppercase tracking-tighter">{p.name}</h4>
                 <p className="text-[9px] text-slate-500 line-clamp-1 italic">"{p.description}"</p>
               </button>
             ))}
          </div>
        </section>
      </main>
    </div>
  );
};

export default App;
