'use client';
import { useEffect, useRef } from 'react';

/** Haze, two sweeping beams and slow glitter. The room before the show. */
export default function StageLights({ dim = false }: { dim?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let w = 0;
    let h = 0;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const resize = () => {
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);
    const colors = ['255,255,255', '255,46,136', '0,229,255', '255,181,71'];
    const specks = Array.from({ length: 70 }, () => ({
      x: Math.random(),
      y: Math.random(),
      r: Math.random() * 1.4 + 0.4,
      c: colors[Math.floor(Math.random() * colors.length)],
      p: Math.random() * Math.PI * 2,
      s: Math.random() * 0.8 + 0.3,
      v: (Math.random() - 0.5) * 0.00006,
    }));
    let raf = 0;
    const draw = (t: number) => {
      ctx.clearRect(0, 0, w, h);
      for (const s of specks) {
        const a = reduce ? 0.35 : (Math.sin(t / 900 * s.s + s.p) + 1) / 2;
        if (a < 0.05) continue;
        s.y -= reduce ? 0 : s.v * 16 + 0.00002;
        if (s.y < -0.02) s.y = 1.02;
        const x = s.x * w;
        const y = s.y * h;
        ctx.beginPath();
        ctx.fillStyle = `rgba(${s.c},${a * 0.8})`;
        ctx.shadowColor = `rgba(${s.c},${a})`;
        ctx.shadowBlur = 8;
        ctx.arc(x, y, s.r * (0.6 + a * 0.6), 0, Math.PI * 2);
        ctx.fill();
      }
      if (!reduce) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <div className={`lights${dim ? ' dim' : ''}`} aria-hidden="true">
      <div className="haze" />
      <div className="beam left" />
      <div className="beam right" />
      <canvas ref={ref} />
    </div>
  );
}
