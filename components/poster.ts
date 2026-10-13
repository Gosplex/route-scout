import type { TourPlan } from '@/lib/types';
import { fmtDate } from './client';

const W = 1080;
const H = 1350;

function fitText(ctx: CanvasRenderingContext2D, text: string, font: (px: number) => string, maxW: number, start: number, min: number) {
  let px = start;
  ctx.font = font(px);
  while (ctx.measureText(text).width > maxW && px > min) {
    px -= 4;
    ctx.font = font(px);
  }
  return px;
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement | null>((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/** Draws a gig poster for the tour and returns a PNG data URL. */
export async function drawPoster(plan: TourPlan): Promise<string> {
  try {
    await Promise.all([document.fonts.load('80px Anton'), document.fonts.load('700 30px Barlow'), document.fonts.load('600 30px Barlow')]);
  } catch {
    /* fall back to system fonts */
  }
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;

  ctx.fillStyle = '#03040b';
  ctx.fillRect(0, 0, W, H);
  const glow = (x: number, y: number, r: number, color: string) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  };
  glow(140, 120, 700, 'rgba(255,46,136,0.35)');
  glow(980, 1250, 760, 'rgba(0,229,255,0.22)');
  glow(900, 300, 420, 'rgba(180,92,255,0.18)');

  // two stage beams
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const beam = (x: number, angle: number, color: string) => {
    ctx.save();
    ctx.translate(x, -40);
    ctx.rotate(angle);
    const g = ctx.createLinearGradient(0, 0, 0, 1200);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(-14, 0);
    ctx.lineTo(14, 0);
    ctx.lineTo(260, 1300);
    ctx.lineTo(-260, 1300);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  };
  beam(160, -0.32, 'rgba(255,46,136,0.28)');
  beam(920, 0.34, 'rgba(0,229,255,0.24)');
  ctx.restore();

  const pad = 80;
  ctx.fillStyle = '#f7f3ea';
  ctx.textBaseline = 'alphabetic';

  ctx.font = '600 28px Barlow, Arial, sans-serif';
  ctx.fillStyle = '#ffb547';
  const year = plan.stops[0] ? new Date(plan.stops[0].date + 'T12:00:00Z').getUTCFullYear() : new Date().getFullYear();
  ctx.fillText(`On tour ${year}`, pad, 130);

  const act = plan.actName.toUpperCase();
  const px = fitText(ctx, act, (p) => `${p}px Anton, Impact, sans-serif`, W - pad * 2, 200, 70);
  ctx.save();
  ctx.shadowColor = 'rgba(255,46,136,0.7)';
  ctx.shadowBlur = 40;
  ctx.fillStyle = '#f7f3ea';
  ctx.fillText(act, pad, 130 + px * 0.95);
  ctx.restore();

  let y = 130 + px * 0.95 + 70;
  const rowH = Math.min(118, (H - y - 190) / Math.max(1, plan.stops.length));
  for (const s of plan.stops) {
    const f = fmtDate(s.date);
    const hidden = s.id === plan.hiddenCityId;
    ctx.fillStyle = hidden ? '#ffb547' : '#ff2e88';
    ctx.font = `${Math.round(rowH * 0.34)}px Anton, Impact, sans-serif`;
    ctx.fillText(`${f.m.toUpperCase()} ${f.d}`, pad, y + rowH * 0.5);
    ctx.fillStyle = hidden ? '#ffb547' : '#f7f3ea';
    const cityTxt = s.name.toUpperCase();
    fitText(ctx, cityTxt, (p) => `${p}px Anton, Impact, sans-serif`, W - pad * 2 - 300, Math.round(rowH * 0.62), 30);
    ctx.fillText(cityTxt, pad + 210, y + rowH * 0.56);
    const cw = ctx.measureText(cityTxt).width;
    ctx.font = `600 ${Math.round(rowH * 0.26)}px Barlow, Arial, sans-serif`;
    ctx.fillStyle = '#a3a1bf';
    ctx.fillText(s.state, pad + 222 + cw, y + rowH * 0.56);
    if (hidden) {
      ctx.font = `700 ${Math.round(rowH * 0.2)}px Barlow, Arial, sans-serif`;
      ctx.fillStyle = '#ffb547';
      ctx.fillText('hidden city', pad + 210, y + rowH * 0.56 + Math.round(rowH * 0.26));
    }
    y += rowH;
  }

  ctx.strokeStyle = 'rgba(247,243,234,0.18)';
  ctx.beginPath();
  ctx.moveTo(pad, H - 150);
  ctx.lineTo(W - pad, H - 150);
  ctx.stroke();
  ctx.fillStyle = '#d9d6ea';
  ctx.font = '600 28px Barlow, Arial, sans-serif';
  const fans = plan.artists.map((a) => a.name);
  const fansTxt = fans.length ? `For fans of ${fans.length > 1 ? fans.slice(0, -1).join(', ') + ' & ' + fans[fans.length - 1] : fans[0]}` : '';
  fitText(ctx, fansTxt, (p) => `600 ${p}px Barlow, Arial, sans-serif`, W - pad * 2 - 260, 28, 18);
  ctx.fillText(fansTxt, pad, H - 98);
  ctx.fillStyle = '#7f7d9c';
  ctx.font = '500 22px Barlow, Arial, sans-serif';
  ctx.fillText('Planned with Route Scout', pad, H - 62);

  const mark = await loadImage('/mark.webp');
  if (mark) ctx.drawImage(mark, W - pad - 110, H - 132, 110, 110);

  return c.toDataURL('image/png');
}
