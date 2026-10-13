/**
 * Tiny cache: in-memory LRU by default, Upstash Redis (REST) when configured.
 * Keeps demos fast and protects API quotas.
 */
type Entry = { v: unknown; exp: number };
const mem = new Map<string, Entry>();
const MAX = 800;

const UP_URL = process.env.UPSTASH_REDIS_REST_URL;
const UP_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const useUpstash = !!(UP_URL && UP_TOKEN);

async function upstash(cmd: (string | number)[]) {
  const res = await fetch(UP_URL as string, {
    method: 'POST',
    headers: { Authorization: `Bearer ${UP_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`cache ${res.status}`);
  return (await res.json()).result;
}

export async function cacheGet<T>(key: string): Promise<T | undefined> {
  const e = mem.get(key);
  if (e) {
    if (e.exp > Date.now()) {
      mem.delete(key);
      mem.set(key, e);
      return e.v as T;
    }
    mem.delete(key);
  }
  if (useUpstash) {
    try {
      const raw = await upstash(['GET', 'rs:' + key]);
      if (raw) {
        const v = JSON.parse(raw);
        mem.set(key, { v, exp: Date.now() + 10 * 60_000 });
        return v as T;
      }
    } catch {
      /* cache is best-effort */
    }
  }
  return undefined;
}

export async function cacheSet(key: string, v: unknown, ttlSec: number) {
  mem.set(key, { v, exp: Date.now() + ttlSec * 1000 });
  if (mem.size > MAX) mem.delete(mem.keys().next().value as string);
  if (useUpstash) {
    try {
      const raw = JSON.stringify(v);
      if (raw.length < 900_000) await upstash(['SET', 'rs:' + key, raw, 'EX', ttlSec]);
    } catch {
      /* best-effort */
    }
  }
}

export async function cached<T>(key: string, ttlSec: number, fn: () => Promise<T>): Promise<T> {
  const hit = await cacheGet<T>(key);
  if (hit !== undefined) return hit;
  const v = await fn();
  await cacheSet(key, v, ttlSec);
  return v;
}
