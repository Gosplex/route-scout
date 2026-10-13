import citiesData from '@/data/us-cities.json';
import type { City, CityScore, HeatPoint } from './types';

export const CITIES: City[] = citiesData as City[];

const R = 6371;
const rad = (x: number) => (x * Math.PI) / 180;

export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Rough door-to-door driving hours for a tour van (road factor + average speed). */
export function driveHours(km: number) {
  return Math.round(((km * 1.2) / 95) * 10) / 10;
}

const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';
export function geohashEncode(lat: number, lng: number, precision = 7) {
  let latR = [-90, 90];
  let lngR = [-180, 180];
  let hash = '';
  let bit = 0;
  let ch = 0;
  let even = true;
  while (hash.length < precision) {
    const r = even ? lngR : latR;
    const v = even ? lng : lat;
    const mid = (r[0] + r[1]) / 2;
    if (v >= mid) {
      ch |= 1 << (4 - bit);
      r[0] = mid;
    } else {
      r[1] = mid;
    }
    even = !even;
    if (bit < 4) bit++;
    else {
      hash += BASE32[ch];
      bit = 0;
      ch = 0;
    }
  }
  return hash;
}

export function geohashDecode(hash: string) {
  let latR = [-90, 90];
  let lngR = [-180, 180];
  let even = true;
  for (const c of hash.toLowerCase()) {
    const cd = BASE32.indexOf(c);
    if (cd < 0) break;
    for (let mask = 16; mask >= 1; mask >>= 1) {
      const r = even ? lngR : latR;
      const mid = (r[0] + r[1]) / 2;
      if (cd & mask) r[0] = mid;
      else r[1] = mid;
      even = !even;
    }
  }
  return { lat: (latR[0] + latR[1]) / 2, lng: (lngR[0] + lngR[1]) / 2 };
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\bsaint\b/g, 'st')
    .replace(/\bst\.?\b/g, 'st')
    .replace(/\bcity\b/g, '')
    .replace(/[^a-z ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const ALIASES: Record<string, string> = {
  nyc: 'new york',
  'new york': 'new york',
  manhattan: 'new york',
  brooklyn: 'new york',
  la: 'los angeles',
  sf: 'san francisco',
  dc: 'washington',
  'washington dc': 'washington',
  philly: 'philadelphia',
  nola: 'new orleans',
  vegas: 'las vegas',
  'twin cities': 'minneapolis',
};

/** Find a city in our dataset from free text like "Boise, ID" or "NYC". */
export function findCity(text: string): City | null {
  if (!text) return null;
  const [rawName, rawState] = text.split(',').map((s) => s.trim());
  let n = norm(rawName || '');
  n = ALIASES[n] || n;
  const st = (rawState || '').toUpperCase().slice(0, 2);
  const matches = CITIES.filter((c) => norm(c.name) === n);
  if (matches.length) {
    const byState = st ? matches.find((c) => c.state === st) : null;
    return byState || matches.sort((a, b) => b.pop - a.pop)[0];
  }
  const loose = CITIES.filter((c) => norm(c.name).startsWith(n) && n.length >= 4).sort((a, b) => b.pop - a.pop);
  return loose[0] || null;
}

export function nearestCity(lat: number, lng: number, maxKm = 70): City | null {
  let best: City | null = null;
  let bestD = Infinity;
  for (const c of CITIES) {
    if (Math.abs(c.lat - lat) > 1.2 || Math.abs(c.lng - lng) > 1.6) continue;
    const d = haversineKm({ lat, lng }, c);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return bestD <= maxKm ? best : null;
}

/** Give every heat cell a 0..1 rank so visuals are not squashed near 0.99. */
export function rankHeat(heat: HeatPoint[]): HeatPoint[] {
  const sorted = [...heat].sort((a, b) => a.affinity - b.affinity || a.popularity - b.popularity);
  const n = Math.max(1, sorted.length - 1);
  sorted.forEach((p, i) => (p.rank = i / n));
  return heat;
}

/** Turn thousands of Qloo heat cells into a ranked list of cities. */
export function aggregateHeatToCities(heat: HeatPoint[]): CityScore[] {
  const buckets = new Map<string, { city: City; vals: number[] }>();
  for (const p of heat) {
    const c = nearestCity(p.lat, p.lng, 60);
    if (!c) continue;
    const b = buckets.get(c.id) || { city: c, vals: [] };
    b.vals.push(p.affinity);
    buckets.set(c.id, b);
  }
  const rows = [...buckets.values()].map(({ city, vals }) => {
    const top = vals.sort((a, b) => b - a).slice(0, 3);
    const tasteRaw = top.reduce((s, v) => s + v, 0) / top.length;
    return { ...city, tasteRaw, cells: vals.length };
  });
  rows.sort((a, b) => b.tasteRaw - a.tasteRaw);
  const n = rows.length;
  return rows.map((r, i) => {
    const taste = n > 1 ? 1 - i / (n - 1) : 1;
    const topPercent = Math.max(1, Math.ceil(((i + 1) / n) * 100));
    return { ...r, taste, topPercent } as CityScore;
  });
}

/** Pick N stops that score well AND sit close enough to tour between. */
export function selectStops(cands: CityScore[], n: number, home: City | null, maxGapKm = 1100): CityScore[] {
  const pool = [...cands].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  if (!pool.length) return [];
  const chosen: CityScore[] = [];
  // Seed: best city (if home given, prefer the best city within 1800 km of home)
  let seed = pool[0];
  if (home) {
    const near = pool.find((c) => haversineKm(home, c) < 1800);
    if (near && (near.score ?? 0) >= (pool[0].score ?? 0) - 12) seed = near;
  }
  chosen.push({ ...seed, fit: 1 });
  while (chosen.length < n) {
    let best: CityScore | null = null;
    let bestVal = -Infinity;
    let bestFit = 0;
    for (const c of pool) {
      if (chosen.some((x) => x.id === c.id)) continue;
      if (chosen.some((x) => haversineKm(x, c) < 120)) continue; // avoid two stops in one metro
      const nearest = Math.min(...chosen.map((x) => haversineKm(x, c)));
      const fit = Math.max(0, 1 - nearest / (maxGapKm * 1.6));
      const val = (c.score ?? 0) / 100 * 0.7 + fit * 0.3 - (nearest > maxGapKm * 1.6 ? 1 : 0);
      if (val > bestVal) {
        bestVal = val;
        best = c;
        bestFit = fit;
      }
    }
    if (!best) break;
    chosen.push({ ...best, fit: Math.round(bestFit * 100) / 100 });
  }
  return chosen;
}

/** Order stops into a short route: nearest-neighbour then 2-opt clean-up. */
export function orderRoute<T extends { lat: number; lng: number }>(stops: T[], start: { lat: number; lng: number } | null): T[] {
  if (stops.length <= 2 && !start) return stops;
  const remaining = [...stops];
  const route: T[] = [];
  let cur: { lat: number; lng: number } =
    start ||
    // start from the westernmost stop for a clean west-to-east sweep
    remaining.reduce((a, b) => (a.lng < b.lng ? a : b));
  if (!start) {
    const first = remaining.splice(remaining.indexOf(cur as T), 1)[0];
    route.push(first);
    cur = first;
  }
  while (remaining.length) {
    let bi = 0;
    let bd = Infinity;
    remaining.forEach((s, i) => {
      const d = haversineKm(cur, s);
      if (d < bd) {
        bd = d;
        bi = i;
      }
    });
    const next = remaining.splice(bi, 1)[0];
    route.push(next);
    cur = next;
  }
  // 2-opt
  const pts = start ? [start as any, ...route] : route;
  const dist = (i: number, j: number) => haversineKm(pts[i], pts[j]);
  let improved = true;
  let guard = 0;
  while (improved && guard++ < 50) {
    improved = false;
    for (let i = start ? 1 : 0; i < pts.length - 2; i++) {
      for (let k = i + 1; k < pts.length - 1; k++) {
        const before = (i > 0 ? dist(i - 1, i) : 0) + dist(k, k + 1);
        const after = (i > 0 ? dist(i - 1, k) : 0) + dist(i, k + 1);
        if (after + 1e-6 < before) {
          const seg = pts.slice(i, k + 1).reverse();
          pts.splice(i, seg.length, ...seg);
          improved = true;
        }
      }
    }
  }
  return (start ? pts.slice(1) : pts) as T[];
}

export function addDays(iso: string, days: number) {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function defaultStartDate() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 28);
  return d.toISOString().slice(0, 10);
}

/** Downsample heat for the browser while keeping the strongest cells. */
export function downsampleHeat(heat: HeatPoint[], max = 4500): HeatPoint[] {
  if (heat.length <= max) return heat;
  const sorted = [...heat].sort((a, b) => (b.rank ?? b.affinity) - (a.rank ?? a.affinity));
  const keepTop = sorted.slice(0, Math.floor(max * 0.6));
  const rest = sorted.slice(Math.floor(max * 0.6));
  const step = rest.length / (max - keepTop.length);
  const sampled: HeatPoint[] = [];
  for (let i = 0; i < rest.length && sampled.length < max - keepTop.length; i += step) sampled.push(rest[Math.floor(i)]);
  return [...keepTop, ...sampled].map((p) => ({
    lat: Math.round(p.lat * 1000) / 1000,
    lng: Math.round(p.lng * 1000) / 1000,
    affinity: Math.round(p.affinity * 10000) / 10000,
    popularity: Math.round(p.popularity * 1000) / 1000,
    rank: Math.round((p.rank ?? 0) * 1000) / 1000,
  }));
}
