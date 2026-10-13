import { cached } from './cache';
import type { Artist, Audience, Brand, HeatPoint, Place, SupportAct } from './types';

const BASE = (process.env.QLOO_BASE_URL || 'https://hackathon.api.qloo.com').replace(/\/$/, '');
export const hasQloo = () => !!process.env.QLOO_API_KEY;

/** Continental US. The heatmap must be given an area; Qloo's city-boundary output errors, so we group cells ourselves. */
export const US_POLYGON = 'POLYGON((-125 24, -66 24, -66 50, -125 50, -125 24))';

export class QlooError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

type Params = Record<string, string | number | boolean | string[] | undefined | null>;

async function qget<T = any>(path: string, params: Params, ttlSec = 6 * 3600): Promise<T> {
  if (!hasQloo()) throw new QlooError('QLOO_API_KEY is not set', 401);
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    url.searchParams.set(k, Array.isArray(v) ? v.join(',') : String(v));
  }
  return cached<T>('qloo:' + url.pathname + url.search, ttlSec, async () => {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 25_000);
      try {
        const res = await fetch(url, {
          headers: { 'X-Api-Key': process.env.QLOO_API_KEY as string, Accept: 'application/json' },
          signal: ctrl.signal,
          cache: 'no-store',
        });
        if (res.status === 429 || res.status >= 500) {
          lastErr = new QlooError(`Qloo ${res.status} on ${path}`, res.status);
          await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
          continue;
        }
        if (!res.ok) throw new QlooError(`Qloo ${res.status} on ${path}: ${(await res.text()).slice(0, 200)}`, res.status);
        return (await res.json()) as T;
      } catch (e: any) {
        lastErr = e;
        if (e instanceof QlooError && e.status < 500 && e.status !== 429) throw e;
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastErr instanceof Error ? lastErr : new QlooError(`Qloo request failed on ${path}`, 500);
  });
}

const entities = (b: any): any[] => (Array.isArray(b?.results) ? b.results : b?.results?.entities || []);
const imageOf = (e: any): string | undefined => e?.properties?.image?.url || undefined;

export async function searchArtists(query: string, take = 5): Promise<Artist[]> {
  const b = await qget('/search', { query, types: 'urn:entity:artist', take });
  return entities(b)
    .filter((e) => e?.entity_id && e?.name)
    .map((e) => ({ id: e.entity_id, name: e.name, image: imageOf(e), popularity: e.popularity }));
}

/** Resolve a typed artist name to the best Qloo match (exact name first, then most popular). */
export async function resolveArtist(name: string): Promise<Artist | null> {
  const list = await searchArtists(name, 5);
  if (!list.length) return null;
  const exact = list.find((a) => a.name.toLowerCase() === name.trim().toLowerCase());
  return exact || list[0];
}

export async function heatmap(ids: string[]): Promise<HeatPoint[]> {
  const b = await qget('/v2/insights', {
    'filter.type': 'urn:heatmap',
    'filter.location': US_POLYGON,
    'signal.interests.entities': ids,
  }, 12 * 3600);
  const rows: any[] = b?.results?.heatmap || [];
  return rows
    .map((h) => ({
      lat: Number(h?.location?.latitude),
      lng: Number(h?.location?.longitude),
      affinity: Number(h?.query?.affinity_rank ?? h?.query?.affinity ?? 0),
      popularity: Number(h?.query?.popularity ?? 0),
    }))
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
}

/** Music genres that describe the seed artists (used to query Ticketmaster). */
export async function genreTags(ids: string[]): Promise<string[]> {
  try {
    const b = await qget('/v2/insights', {
      'filter.type': 'urn:tag',
      'filter.tag.types': 'urn:tag:genre:music',
      'signal.interests.entities': ids,
      take: 10,
    });
    const tags: any[] = b?.results?.tags || entities(b);
    const names = tags.map((t) => t?.name).filter(Boolean);
    if (names.length) return names;
  } catch {
    /* fall through */
  }
  if (ids.length >= 2) {
    try {
      const b = await qget('/v2/analysis/compare', {
        'a.signal.interests.entities': ids[0],
        'b.signal.interests.entities': ids[1],
        take: 10,
      });
      const tags: any[] = b?.results?.tags || [];
      return tags.filter((t) => String(t?.tag_id || t?.id || '').includes('genre')).map((t) => t.name);
    } catch {
      /* ignore */
    }
  }
  return [];
}

/** Find which seed artist most drove a recommendation (Qloo explainability). */
function explain(e: any, seedNames: Map<string, string>): string | undefined {
  const ex = e?.query?.explainability;
  if (!ex) return undefined;
  const found: { id: string; score: number }[] = [];
  const walk = (o: any) => {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) return o.forEach(walk);
    const id = o.entity_id || o.id;
    const score = typeof o.score === 'number' ? o.score : typeof o.value === 'number' ? o.value : undefined;
    if (id && score !== undefined) found.push({ id, score });
    Object.values(o).forEach(walk);
  };
  walk(ex);
  const top = found.filter((f) => seedNames.has(f.id)).sort((a, b) => b.score - a.score)[0];
  return top ? `Strongest link: fans of ${seedNames.get(top.id)} (${Math.round(top.score * 100)}%)` : undefined;
}

export async function supportActs(ids: string[], city?: string, take = 8, seedNames = new Map<string, string>()): Promise<SupportAct[]> {
  const params = {
    'filter.type': 'urn:entity:artist',
    'signal.interests.entities': ids,
    'filter.exclude.entities': ids,
    'filter.popularity.max': 0.6,
    'feature.explainability': true,
    take,
  };
  let b: any;
  try {
    b = await qget('/v2/insights', city ? { ...params, 'signal.location.query': city } : params);
  } catch (e) {
    if (!city) throw e;
    b = await qget('/v2/insights', params); // location signal unsupported -> global list
  }
  return entities(b).map((e) => ({ id: e.entity_id, name: e.name, image: imageOf(e), why: explain(e, seedNames) }));
}

export async function places(ids: string[], city: string, tag?: string, take = 10): Promise<Place[]> {
  const b = await qget('/v2/insights', {
    'filter.type': 'urn:entity:place',
    'signal.interests.entities': ids,
    'filter.location.query': city,
    'filter.tags': tag,
    take,
  });
  return entities(b).map((e) => ({
    id: e.entity_id,
    name: e.name,
    image: imageOf(e),
    address: e?.properties?.address,
  }));
}

export async function brands(ids: string[], city: string, take = 8, seedNames = new Map<string, string>()): Promise<Brand[]> {
  const b = await qget('/v2/insights', {
    'filter.type': 'urn:entity:brand',
    'signal.interests.entities': ids,
    'signal.location.query': city,
    'feature.explainability': true,
    take,
  });
  return entities(b).map((e) => ({ id: e.entity_id, name: e.name, image: imageOf(e), why: explain(e, seedNames) }));
}

const NOISE_TAGS = new Set(['bar', 'restaurant', 'tourist attraction', 'hotel', 'park', 'store', 'shop', 'fries', 'hamburger']);

export async function tasteTags(ids: string[], city: string, take = 15): Promise<string[]> {
  const b = await qget('/v2/insights', {
    'filter.type': 'urn:tag',
    'signal.interests.entities': ids,
    'signal.location.query': city,
    take,
  });
  const tags: any[] = b?.results?.tags || entities(b);
  return tags
    .map((t) => String(t?.name || '').trim())
    .filter((n) => n && !NOISE_TAGS.has(n.toLowerCase()))
    .slice(0, 8);
}

export async function demographics(ids: string[]): Promise<Audience | null> {
  const b = await qget('/v2/insights', { 'filter.type': 'urn:demographics', 'signal.interests.entities': ids });
  const rows: any[] = b?.results?.demographics || [];
  if (!rows.length) return null;
  const avg = (key: 'age' | 'gender') => {
    const out: Record<string, number> = {};
    rows.forEach((r) => Object.entries(r?.query?.[key] || {}).forEach(([k, v]) => (out[k] = (out[k] || 0) + Number(v) / rows.length)));
    Object.keys(out).forEach((k) => (out[k] = Math.round(out[k] * 100) / 100));
    return out;
  };
  return { age: avg('age'), gender: avg('gender') };
}

/** True when Qloo's weekly trend data shows the artist climbing. */
export async function isRising(id: string): Promise<boolean> {
  const end = new Date();
  const start = new Date(Date.now() - 90 * 864e5);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  try {
    const b = await qget('/v2/trending', {
      'signal.interests.entities': id,
      'filter.type': 'urn:entity:artist',
      'filter.start_date': iso(start),
      'filter.end_date': iso(end),
      take: 6,
    }, 24 * 3600);
    const t: any[] = b?.results?.trending || [];
    if (t.length < 2) return false;
    const latest = t[0];
    return Number(latest.population_rank_velocity) > 0 || Number(latest.velocity_fold_change) > 1.05 || Number(latest.population_percent_delta) > 0.02;
  } catch {
    return false;
  }
}
