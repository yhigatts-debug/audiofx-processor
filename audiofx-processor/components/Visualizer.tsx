
import React, { useEffect, useRef } from 'react';

interface VisualizerProps {
  analyserA: AnalyserNode | null;
  analyserB: AnalyserNode | null;
  colorA: string;
  colorB: string;
  labelA: string;
  labelB: string;
}

const Visualizer: React.FC<VisualizerProps> = React.memo(({ analyserA, analyserB, colorA, colorB, labelA, labelB }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const smoothedDataA = useRef<Float32Array | null>(null);
  const smoothedDataB = useRef<Float32Array | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    let animationId: number;
    const fftSize = analyserA?.fftSize || 2048;
    const bufferLength = fftSize / 2;
    const dataArray = new Uint8Array(bufferLength);
    
    if (!smoothedDataA.current || smoothedDataA.current.length !== bufferLength) {
      smoothedDataA.current = new Float32Array(bufferLength);
      smoothedDataB.current = new Float32Array(bufferLength);
    }

    const minFreq = 20;
    const maxFreq = 20000;
    const logMin = Math.log10(minFreq);
    const logMax = Math.log10(maxFreq);

    const getX = (freq: number, w: number) => {
      const logFreq = Math.log10(Math.max(minFreq, freq));
      return ((logFreq - logMin) / (logMax - logMin)) * w;
    };

    // ポイントを計算する関数
    const getPoints = (analyser: AnalyserNode | null, smoothedArray: Float32Array, width: number, graphHeight: number) => {
      if (!analyser || !analyser.context) return null;
      try {
        analyser.getByteFrequencyData(dataArray);
      } catch (e) { return null; }

      const sf = 0.82; 
      for (let i = 0; i < bufferLength; i++) {
        smoothedArray[i] = smoothedArray[i] * sf + dataArray[i] * (1 - sf);
      }

      const points: {x: number, y: number}[] = [];
      const step = 4;
      const sampleRate = analyser.context.sampleRate;
      const binToFreq = sampleRate / fftSize;

      for (let x = 0; x <= width; x += step) {
        const freq = Math.pow(10, logMin + (x / width) * (logMax - logMin));
        const bin = Math.round(freq / binToFreq);
        if (bin >= bufferLength) break;

        const val = smoothedArray[bin] / 255;
        const mag = Math.pow(val, 0.5) * 1.1; 
        const y = graphHeight - Math.min(1, mag) * graphHeight;
        points.push({x, y});
      }
      return points;
    };

    const render = () => {
      const w = canvas.width;
      const h = canvas.height;
      const lh = 30;
      const gh = h - lh;

      ctx.fillStyle = '#0a0a0c';
      ctx.fillRect(0, 0, w, h);

      // グリッド
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      [20, 100, 1000, 10000, 20000].forEach(f => {
        const x = getX(f, w);
        ctx.moveTo(x, 0); ctx.lineTo(x, gh);
      });
      ctx.stroke();

      // 周波数ラベル
      ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      [100, 1000, 10000].forEach(f => {
        const x = getX(f, w);
        ctx.fillText(f >= 1000 ? `${f/1000}kHz` : `${f}Hz`, x, h - 10);
      });

      const pointsA = getPoints(analyserA, smoothedDataA.current!, w, gh);
      const pointsB = getPoints(analyserB, smoothedDataB.current!, w, gh);

      // --- 1. まず塗りつぶしだけを先に描く (重なりを許容) ---
      [ {p: pointsA, c: colorA}, {p: pointsB, c: colorB} ].forEach(obj => {
        if (!obj.p || obj.p.length === 0) return;
        ctx.beginPath();
        ctx.moveTo(obj.p[0].x, obj.p[0].y);
        obj.p.forEach(pt => ctx.lineTo(pt.x, pt.y));
        ctx.lineTo(w, gh);
        ctx.lineTo(0, gh);
        ctx.closePath();
        ctx.fillStyle = obj.c + '12'; // 透明度をさらに下げて比較しやすく(約7%)
        ctx.fill();
      });

      // --- 2. 次に線を上に描く (Out Bを強調) ---
      if (pointsA && pointsA.length > 0) {
        ctx.beginPath();
        ctx.strokeStyle = colorA;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([]);
        ctx.moveTo(pointsA[0].x, pointsA[0].y);
        pointsA.forEach(pt => ctx.lineTo(pt.x, pt.y));
        ctx.stroke();
      }

      if (pointsB && pointsB.length > 0) {
        // Out Bにグロー効果を加える
        ctx.shadowBlur = 8;
        ctx.shadowColor = colorB;
        ctx.beginPath();
        ctx.strokeStyle = colorB;
        ctx.lineWidth = 2.5; // Out Bの線を太く
        ctx.moveTo(pointsB[0].x, pointsB[0].y);
        pointsB.forEach(pt => ctx.lineTo(pt.x, pt.y));
        ctx.stroke();
        ctx.shadowBlur = 0; // 他の描画に影響しないよう戻す
      }

      // 凡例
      ctx.textAlign = 'left';
      ctx.font = 'bold 11px Inter';
      ctx.fillStyle = colorA; ctx.fillRect(20, 20, 8, 8);
      ctx.fillStyle = '#fff'; ctx.fillText(labelA, 35, 28);
      ctx.fillStyle = colorB; ctx.fillRect(20, 40, 8, 8);
      ctx.fillStyle = '#fff'; ctx.fillText(labelB, 35, 48);

      animationId = requestAnimationFrame(render);
    };

    animationId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animationId);
  }, [analyserA, analyserB, colorA, colorB, labelA, labelB]);

  return (
    <div className="relative w-full h-full bg-[#0a0a0c] rounded-3xl overflow-hidden border border-white/10 shadow-inner">
      <canvas ref={canvasRef} width={800} height={400} className="w-full h-full block" />
    </div>
  );
});

export default Visualizer;
