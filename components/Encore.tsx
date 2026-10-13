'use client';
import { useEffect, useRef, useState } from 'react';
import type { TourPlan } from '@/lib/types';
import { shareUrl } from './client';
import { drawPoster } from './poster';
import { track } from './track';

export default function Encore({ plan, onClose }: { plan: TourPlan; onClose: () => void }) {
  const confetti = useRef<HTMLCanvasElement>(null);
  const [poster, setPoster] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const backRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    drawPoster(plan).then(setPoster).catch(() => setPoster(null));
  }, [plan]);

  useEffect(() => {
    backRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    const c = confetti.current;
    if (!c || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = c.clientWidth * dpr;
    c.height = c.clientHeight * dpr;
    ctx.scale(dpr, dpr);
    const W = c.clientWidth;
    const colors = ['#ff2e88', '#00e5ff', '#ffb547', '#b45cff', '#f7f3ea'];
    const parts = Array.from({ length: 180 }, (_, i) => ({
      x: W / 2 + (Math.random() - 0.5) * 120,
      y: 120,
      vx: (Math.random() - 0.5) * 16,
      vy: -Math.random() * 12 - 4,
      r: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.3,
      w: 6 + Math.random() * 8,
      h: 4 + Math.random() * 6,
      c: colors[i % colors.length],
    }));
    const start = performance.now();
    let raf = 0;
    const loop = (t: number) => {
      const el = t - start;
      ctx.clearRect(0, 0, c.clientWidth, c.clientHeight);
      for (const p of parts) {
        p.vy += 0.28;
        p.vx *= 0.99;
        p.x += p.vx;
        p.y += p.vy;
        p.r += p.vr;
        ctx.save();
        ctx.globalAlpha = Math.max(0, 1 - el / 3800);
        ctx.translate(p.x, p.y);
        ctx.rotate(p.r);
        ctx.fillStyle = p.c;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.r * 2)));
        ctx.restore();
      }
      if (el < 4000) raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const copy = async () => {
    track('share_link_copied');
    const url = shareUrl(plan);
    try {
      await navigator.clipboard.writeText(url);
      setToast('Link copied');
    } catch {
      window.prompt('Copy this link', url);
    }
    setTimeout(() => setToast(null), 2200);
  };

  const fileName = `${plan.actName.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'tour'}-poster.png`;

  return (
    <div className="encore" role="dialog" aria-modal="true" aria-labelledby="encore-title">
      <div className="specks" aria-hidden="true" />
      <div className="discoball" aria-hidden="true" />
      <canvas className="confetti" ref={confetti} aria-hidden="true" />
      <div className="encore-inner">
        <div>
          <h2 id="encore-title" className="display">
            Tour locked
          </h2>
          <p style={{ fontSize: 20, maxWidth: '30em' }}>
            {plan.stops.length} shows, starting {plan.stops[0] ? new Date(plan.stops[0].date + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' }) : 'soon'}. Download the poster or send the route to your band.
          </p>
          <div className="actions">
            {poster ? (
              <a className="btn primary" href={poster} download={fileName} onClick={() => track('poster_downloaded')}>
                Download poster
              </a>
            ) : (
              <span className="btn">Drawing poster</span>
            )}
            <button className="btn" onClick={copy}>
              Copy share link
            </button>
            <button ref={backRef} className="btn" onClick={onClose}>
              Back to the tour
            </button>
          </div>
        </div>
        <div>{poster ? <img className="poster-preview" src={poster} alt={`Tour poster for ${plan.actName}`} /> : <div className="skeleton" style={{ aspectRatio: '4 / 5', height: 'auto' }} />}</div>
      </div>
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
