import { cached } from './cache';
import { geohashEncode, haversineKm } from './geo';

const TM = 'https://app.ticketmaster.com/discovery/v2';
export const hasTicketmaster = () => !!process.env.TICKETMASTER_API_KEY;

/** Map Qloo genre names (and the user's own words) onto Ticketmaster genre names. */
const GENRE_MAP: [RegExp, string][] = [
  [/hip.?hop|rap|trap|drill/i, 'Hip-Hop/Rap'],
  [/r&b|rnb|soul|neo.?soul/i, 'R&B'],
  [/folk|singer.?songwriter|acoustic/i, 'Folk'],
  [/americana|country|bluegrass|alt.?country/i, 'Country'],
  [/metal|hardcore|metalcore/i, 'Metal'],
  [/punk|emo|indie|alternative|shoegaze|dream.?pop|post.?rock|lo.?fi/i, 'Alternative'],
  [/electronic|house|techno|edm|dance|dubstep|synth/i, 'Dance/Electronic'],
  [/jazz/i, 'Jazz'],
  [/blues/i, 'Blues'],
  [/latin|reggaeton|cumbia|regional mexican/i, 'Latin'],
  [/reggae|dancehall/i, 'Reggae'],
  [/classical|orchestra|opera/i, 'Classical'],
  [/comedy|stand.?up|comedian/i, 'Comedy'],
  [/pop/i, 'Pop'],
  [/rock/i, 'Rock'],
];

export function toTicketmasterGenre(texts: string[]): string | null {
  const joined = texts.join(' | ');
  for (const [re, name] of GENRE_MAP) if (re.test(joined)) return name;
  return null;
}

let chain: Promise<void> = Promise.resolve();
function throttle(): Promise<void> {
  const next = chain.then(() => new Promise<void>((r) => setTimeout(r, 230)));
  chain = next.catch(() => undefined);
  return next;
}

const isoZ = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');

async function tmGet(path: string, params: Record<string, string | number | undefined>, ttlSec = 6 * 3600): Promise<any> {
  if (!hasTicketmaster()) throw new Error('TICKETMASTER_API_KEY is not set');
  const url = new URL(TM + path);
  Object.entries(params).forEach(([k, v]) => v !== undefined && v !== '' && url.searchParams.set(k, String(v)));
  const cacheKey = 'tm:' + url.pathname + url.search;
  url.searchParams.set('apikey', process.env.TICKETMASTER_API_KEY as string);
  return cached(cacheKey, ttlSec, async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      await throttle();
      const res = await fetch(url, { cache: 'no-store' });
      if (res.status === 429) {
        await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
        continue;
      }
      if (!res.ok) throw new Error(`Ticketmaster ${res.status}`);
      return res.json();
    }
    throw new Error('Ticketmaster rate limit');
  });
}

export type TmVenue = { name: string; shows: number; url?: string };

function dateWindow(days = 180) {
  const start = new Date();
  const end = new Date(Date.now() + days * 864e5);
  return { startDateTime: isoZ(start), endDateTime: isoZ(end) };
}

function venuesFrom(body: any): TmVenue[] {
  const counts = new Map<string, TmVenue>();
  for (const ev of body?._embedded?.events || []) {
    const v = ev?._embedded?.venues?.[0];
    if (!v?.name) continue;
    const cur = counts.get(v.name) || { name: v.name, shows: 0, url: v.url };
    cur.shows++;
    counts.set(v.name, cur);
  }
  return [...counts.values()].sort((a, b) => b.shows - a.shows);
}

/** Count upcoming ticketed shows near a city, overall music and in the artist's genre. */
export async function showDensity(city: { lat: number; lng: number }, genre: string | null, radiusMi = 35) {
  const base = {
    geoPoint: geohashEncode(city.lat, city.lng, 7),
    radius: radiusMi,
    unit: 'miles',
    countryCode: 'US',
    size: 100,
    sort: 'date,asc',
    ...dateWindow(180),
  };
  const music = await tmGet('/events.json', { ...base, segmentName: 'Music' });
  const musicShows = Number(music?.page?.totalElements || 0);
  let genreShows: number | undefined;
  let venues = venuesFrom(music);
  if (genre && genre !== 'Comedy') {
    const g = await tmGet('/events.json', { ...base, classificationName: genre });
    genreShows = Number(g?.page?.totalElements || 0);
    const gv = venuesFrom(g);
    if (gv.length) venues = gv;
  } else if (genre === 'Comedy') {
    const g = await tmGet('/events.json', { ...base, classificationName: 'Comedy' });
    genreShows = Number(g?.page?.totalElements || 0);
    venues = venuesFrom(g);
  }
  return { musicShows, genreShows, venues: venues.slice(0, 8) };
}

/** Where the similar artists already have US dates booked. */
export async function upcomingDates(artistName: string) {
  const b = await tmGet('/events.json', {
    keyword: artistName,
    countryCode: 'US',
    size: 100,
    sort: 'date,asc',
    ...dateWindow(180),
  });
  const want = artistName.trim().toLowerCase();
  const out: { artist: string; date: string; venue?: string; lat: number; lng: number }[] = [];
  for (const ev of b?._embedded?.events || []) {
    const atts: any[] = ev?._embedded?.attractions || [];
    if (!atts.some((a) => String(a?.name || '').toLowerCase() === want)) continue;
    const v = ev?._embedded?.venues?.[0];
    const lat = Number(v?.location?.latitude);
    const lng = Number(v?.location?.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    out.push({ artist: artistName, date: ev?.dates?.start?.localDate || '', venue: v?.name, lat, lng });
  }
  return out;
}

export function bookedNear(
  dates: { artist: string; date: string; venue?: string; lat: number; lng: number }[],
  city: { lat: number; lng: number },
  km = 60,
) {
  return dates.filter((d) => haversineKm(d, city) <= km).map(({ artist, date, venue }) => ({ artist, date, venue }));
}
