'use client';
import { useEffect, useRef } from 'react';
import { geoGraticule10, geoOrthographic, geoPath } from 'd3-geo';
import { feature } from 'topojson-client';
import land110 from 'world-atlas/land-110m.json';
import { CITIES } from '@/lib/geo';
import type { HeatPoint } from '@/lib/types';

const landGeo = feature(land110 as any, (land110 as any).objects.land) as any;
const grat = geoGraticule10();

/** Rotating stage-lit globe. Before data: scanning twinkles. After data: real taste cells switch on. */
export default function Globe({ heat, phase }: { heat: HeatPoint[]; phase: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const heatRef = useRef<HeatPoint[]>([]);
  const heatAt = useRef(0);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  useEffect(() => {
    if (heat.length && heatRef.current !== heat) {
      heatRef.current = [...heat].sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0)).slice(0, 1600);
      heatAt.current = performance.now();
    }
  }, [heat]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    let size = 0;
    const proj = geoOrthographic().clipAngle(90).precision(0.6);
    const path = geoPath(proj, ctx);
    const resize = () => {
      size = canvas.clientWidth;
      canvas.width = size * dpr;
      canvas.height = size * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      proj.translate([size / 2, size / 2]).scale(size * 0.43);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    let lambda = 20;
    let phi = -28;
    const target = { l: 98, p: -36 }; // centre on the US
    const start = performance.now();
    let raf = 0;

    const draw = (t: number) => {
      const el = (t - start) / 1000;
      // spin, then glide to the US once data begins arriving
      if (phaseRef.current >= 1 || el > 3) {
        lambda += (target.l - lambda) * 0.03;
        phi += (target.p - phi) * 0.03;
      } else {
        lambda += 0.35;
      }
      proj.rotate([lambda, phi]);
      const r = size * 0.43;
      const c = size / 2;
      ctx.clearRect(0, 0, size, size);

      // atmosphere glow
      const glow = ctx.createRadialGradient(c, c, r * 0.9, c, c, r * 1.22);
      glow.addColorStop(0, 'rgba(255,46,136,0.35)');
      glow.addColorStop(0.5, 'rgba(0,229,255,0.10)');
      glow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(c, c, r * 1.22, 0, Math.PI * 2);
      ctx.fill();

      // ocean
      const ocean = ctx.createRadialGradient(c - r * 0.35, c - r * 0.4, r * 0.1, c, c, r);
      ocean.addColorStop(0, '#191a3a');
      ocean.addColorStop(1, '#05060f');
      ctx.fillStyle = ocean;
      ctx.beginPath();
      path({ type: 'Sphere' } as any);
      ctx.fill();

      ctx.beginPath();
      path(grat as any);
      ctx.strokeStyle = 'rgba(0,229,255,0.07)';
      ctx.lineWidth = 0.6;
      ctx.stroke();

      ctx.beginPath();
      path(landGeo);
      ctx.fillStyle = '#121433';
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,229,255,0.28)';
      ctx.lineWidth = 0.7;
      ctx.stroke();

      const visible = (lng: number, lat: number) => {
        const rot = proj.rotate();
        const toRad = Math.PI / 180;
        const l = (lng + rot[0]) * toRad;
        const p = lat * toRad;
        const p0 = -rot[1] * toRad;
        return Math.sin(p0) * Math.sin(p) + Math.cos(p0) * Math.cos(p) * Math.cos(l) > 0.05;
      };

      ctx.globalCompositeOperation = 'lighter';
      const cells = heatRef.current;
      if (cells.length) {
        const since = (t - heatAt.current) / 1000;
        const shown = reduce ? cells.length : Math.floor(Math.min(1, since / 2.2) * cells.length);
        for (let i = shown - 1; i >= 0; i--) {
          const h = cells[i];
          if (!visible(h.lng, h.lat)) continue;
          const xy = proj([h.lng, h.lat]);
          if (!xy) continue;
          const k = h.rank ?? 0.5;
          const col = k > 0.985 ? '255,181,71' : k > 0.9 ? '255,46,136' : '0,229,255';
          const rad = 0.8 + Math.pow(k, 6) * 3.2;
          ctx.fillStyle = `rgba(${col},${0.25 + k * 0.6})`;
          ctx.beginPath();
          ctx.arc(xy[0], xy[1], rad, 0, Math.PI * 2);
          ctx.fill();
        }
      } else {
        // scanning: cities blink on and off like lights on a rig
        for (let i = 0; i < CITIES.length; i += 1) {
          const city = CITIES[i];
          const a = (Math.sin(el * 2.4 + i * 1.7) + 1) / 2;
          if (a < 0.6 || !visible(city.lng, city.lat)) continue;
          const xy = proj([city.lng, city.lat]);
          if (!xy) continue;
          ctx.fillStyle = `rgba(${i % 3 ? '0,229,255' : '255,46,136'},${(a - 0.6) * 2})`;
          ctx.beginPath();
          ctx.arc(xy[0], xy[1], 1.6, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalCompositeOperation = 'source-over';

      // rim light
      ctx.beginPath();
      ctx.arc(c, c, r, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.lineWidth = 1;
      ctx.stroke();

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return <canvas ref={ref} role="img" aria-label="Globe showing where your fans are" />;
}
