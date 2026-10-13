import { chat, hasOpenRouter } from './openrouter';
import { brands, isRising, places, supportActs, tasteTags } from './qloo';
import { hasTicketmaster, showDensity } from './ticketmaster';
import type { CityDetail, Place, Venue } from './types';

const VENUE_TAG = 'urn:tag:genre:place:live_music_venue';

const n = (s: string) => s.toLowerCase().replace(/^the\s+/, '').replace(/[^a-z0-9]/g, '');

export type DetailInput = {
  ids: string[];
  seedNames: string[];
  cityId: string;
  city: string;
  state: string;
  lat: number;
  lng: number;
  genre: string | null;
};

export async function buildCityDetail(q: DetailInput): Promise<CityDetail> {
  const where = `${q.city}, ${q.state}`;
  const seeds = new Map(q.ids.map((id, i) => [id, q.seedNames[i] || 'your artists']));
  const safe = <T,>(p: Promise<T>, fb: T) => p.catch(() => fb);

  const [tags, brandList, venuesQ, hangoutsQ, acts, tm] = await Promise.all([
    safe(tasteTags(q.ids, where), [] as string[]),
    safe(brands(q.ids, where, 8, seeds), []),
    safe(places(q.ids, where, VENUE_TAG, 10), [] as Place[]),
    safe(places(q.ids, where, undefined, 14), [] as Place[]),
    safe(supportActs(q.ids, where, 8, seeds), []),
    hasTicketmaster() ? safe(showDensity(q, q.genre), null) : Promise.resolve(null),
  ]);

  // Venues: Ticketmaster venues with real upcoming shows, confirmed or extended by Qloo's live-music places.
  const venues: Venue[] = (tm?.venues || []).map((v) => ({ name: v.name, shows: v.shows, url: v.url, source: 'ticketmaster' as const }));
  for (const p of venuesQ) {
    const match = venues.find((v) => n(v.name).includes(n(p.name)) || n(p.name).includes(n(v.name)));
    if (match) match.source = 'both';
  }
  // Qloo-only "live music" places are often bars or restaurants that host music; list them as hangouts, not venues.
  const venueNames = new Set(venues.map((v) => n(v.name)));
  const hangouts = [...hangoutsQ, ...venuesQ]
    .filter((p, i, arr) => arr.findIndex((x) => n(x.name) === n(p.name)) === i)
    .filter((p) => !venueNames.has(n(p.name)))
    .slice(0, 6);

  const top = acts.slice(0, 6);
  const rising = await Promise.all(top.slice(0, 4).map((a) => isRising(a.id)));
  rising.forEach((r, i) => (top[i].rising = r));

  const crowdLine = await writeCrowdLine(q.city, tags, brandList.map((b) => b.name), hangouts.map((h) => h.name));

  return {
    cityId: q.cityId,
    city: q.city,
    state: q.state,
    crowdLine,
    tags,
    brands: brandList.slice(0, 6),
    hangouts,
    venues: venues.slice(0, 6),
    supportActs: top,
    sources: { qloo: true, ticketmaster: !!tm, ai: hasOpenRouter() },
  };
}

function templateLine(city: string, tags: string[], brandNames: string[], hangouts: string[]) {
  const bits: string[] = [];
  const t = tags.slice(0, 2).join(' and ').toLowerCase();
  const b = brandNames.slice(0, 2).join(' and ');
  if (t) bits.push(`leans ${t}`);
  if (b) bits.push(`shops ${b}`);
  if (hangouts[0]) bits.push(`hangs out at places like ${hangouts[0]}`);
  if (!bits.length) return `Your ${city} crowd is out there waiting.`;
  const last = bits.pop();
  return `Your ${city} crowd ${bits.length ? bits.join(', ') + ', and ' + last : last}.`;
}

async function writeCrowdLine(city: string, tags: string[], brandNames: string[], hangouts: string[]) {
  const fallback = templateLine(city, tags, brandNames, hangouts);
  if (!hasOpenRouter() || (!tags.length && !brandNames.length)) return fallback;
  try {
    const r = await chat(
      [
        {
          role: 'system',
          content:
            'You write one vivid sentence (max 28 words) describing a concert crowd for a touring artist. Use ONLY the names provided. No other brand, venue or artist names. No hashtags, no emojis.',
        },
        { role: 'user', content: JSON.stringify({ city, taste_tags: tags.slice(0, 6), brands: brandNames.slice(0, 5), hangouts: hangouts.slice(0, 4) }) },
      ],
      { temperature: 0.6, maxTokens: 90, timeoutMs: 12_000 },
    );
    const line = (r.content || '').trim().replace(/^["']|["']$/g, '');
    const allowed = [...brandNames, ...hangouts];
    const mentions = allowed.some((x) => line.includes(x)) || tags.some((x) => line.toLowerCase().includes(x.toLowerCase()));
    return line && line.length <= 240 && mentions ? line : fallback;
  } catch {
    return fallback;
  }
}
