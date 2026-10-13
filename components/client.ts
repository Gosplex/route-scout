import { addDays, driveHours, haversineKm, orderRoute } from '@/lib/geo';
import type { CityScore, Stop, StreamMessage, TourPlan } from '@/lib/types';

export async function streamAgent(body: Record<string, unknown>, onMsg: (m: StreamMessage) => void, signal?: AbortSignal) {
  const res = await fetch('/api/agent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    let msg = `Request failed (${res.status})`;
    try {
      msg = (await res.json()).error || msg;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const line = chunk.split('\n').find((l) => l.startsWith('data: '));
      if (!line) continue;
      let msg: StreamMessage | null = null;
      try {
        msg = JSON.parse(line.slice(6));
      } catch {
        /* skip malformed chunk */
      }
      if (msg) onMsg(msg);
    }
  }
}

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();

export function fmtDate(iso: string) {
  const d = new Date(iso + 'T12:00:00Z');
  return {
    m: d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }),
    d: d.getUTCDate(),
    w: d.toLocaleString('en-US', { weekday: 'short', timeZone: 'UTC' }),
    long: d.toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }),
  };
}

/** Recompute legs and dates after the user changes the order. */
export function redate(plan: TourPlan, stops: CityScore[] | Stop[]): Stop[] {
  const start = plan.stops[0]?.date || new Date().toISOString().slice(0, 10);
  let prev: { lat: number; lng: number } | null = plan.home;
  let date = start;
  return stops.map((c, i) => {
    const legKm = prev ? Math.round(haversineKm(prev, c)) : 0;
    const legHours = driveHours(legKm);
    if (i > 0) date = addDays(date, legHours > 9 ? 2 : 1);
    prev = c;
    return { ...(c as CityScore), order: i + 1, date, legKm, legHours };
  });
}

export function moveStop(plan: TourPlan, from: number, to: number): Stop[] {
  const arr = [...plan.stops];
  const [x] = arr.splice(from, 1);
  arr.splice(to, 0, x);
  return redate(plan, arr);
}

/** Swap a stop for the best unused candidate, preferring cities near it. Returns null if none left. */
export function swapStop(plan: TourPlan, index: number): Stop[] | null {
  const target = plan.stops[index];
  const used = new Set(plan.stops.map((s) => s.id));
  const options = plan.candidates.filter((c) => !used.has(c.id) && !plan.stops.some((s) => haversineKm(s, c) < 120));
  if (!options.length) return null;
  const rated = options
    .map((c) => {
      const score = c.score ?? Math.round(c.taste * 70);
      const dist = haversineKm(target, c);
      return { c, v: score / 100 - dist / 3000 };
    })
    .sort((a, b) => b.v - a.v);
  const pick = rated[0].c;
  const rest = plan.stops.filter((_, i) => i !== index);
  const ordered = orderRoute([...rest, { ...pick, score: pick.score ?? Math.round(pick.taste * 70) } as CityScore], plan.home);
  return redate(plan, ordered);
}

// ------------------------------------------------------------------ share links (tour summary only)

type Shared = {
  v: 1;
  a: string;
  r: string[];
  h: number;
  s: [string, string, number, number, string, number, number][];
};

const b64u = {
  enc: (s: string) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  dec: (s: string) => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/')))),
};

export function shareUrl(plan: TourPlan) {
  const data: Shared = {
    v: 1,
    a: plan.actName,
    r: plan.artists.map((x) => x.name),
    h: plan.stops.findIndex((s) => s.id === plan.hiddenCityId),
    s: plan.stops.map((s) => [s.name, s.state, s.lat, s.lng, s.date, s.score ?? 0, s.topPercent]),
  };
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return `${origin}/?tour=${b64u.enc(JSON.stringify(data))}`;
}

export function planFromShare(token: string): TourPlan | null {
  try {
    const d = JSON.parse(b64u.dec(token)) as Shared;
    if (d.v !== 1 || !Array.isArray(d.s)) return null;
    const stops: Stop[] = d.s.slice(0, 12).map((x, i) => ({
      id: `share-${i}`,
      name: String(x[0]).slice(0, 40),
      state: String(x[1]).slice(0, 2),
      lat: Number(x[2]),
      lng: Number(x[3]),
      date: String(x[4]).slice(0, 10),
      score: Number(x[5]),
      topPercent: Number(x[6]),
      pop: 0,
      taste: 1,
      tasteRaw: 1,
      cells: 0,
      order: i + 1,
      legKm: 0,
      legHours: 0,
    }));
    const hidden = stops[d.h]?.id || null;
    return {
      id: 'shared',
      actName: String(d.a || 'A tour').slice(0, 40),
      artists: (d.r || []).slice(0, 5).map((n, i) => ({ id: `r${i}`, name: String(n).slice(0, 60) })),
      sound: '',
      genre: null,
      home: null,
      stops: redate({ stops, home: null } as unknown as TourPlan, stops),
      candidates: [],
      heat: [],
      baseline: { source: 'fallback', names: [], cities: [] },
      hiddenCityId: hidden,
      headline: hidden ? `${stops[d.h].name} is on the route` : 'Tour route',
      summary: '',
      audience: null,
      sources: { qloo: false, ticketmaster: false, ai: false },
      agent: { mode: 'autopilot', steps: 0 },
      createdAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}
