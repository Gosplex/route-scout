import { demoDetail } from '@/lib/demo';
import { buildCityDetail } from '@/lib/detail';
import { hasQloo } from '@/lib/qloo';
import { allow, ipOf } from '@/lib/ratelimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 45;

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const cityId = (q.get('cityId') || '').slice(0, 20);
  if (q.get('demo') === '1') {
    const d = demoDetail(cityId);
    return d ? Response.json(d) : Response.json({ error: 'No sample data for this city.' }, { status: 404 });
  }
  if (!hasQloo()) return Response.json({ error: 'Live mode needs QLOO_API_KEY on the server.' }, { status: 503 });
  if (!allow(ipOf(req), 60, 10 * 60_000)) return Response.json({ error: 'Too many requests. Try again in a few minutes.' }, { status: 429 });
  const ids = (q.get('ids') || '').split(',').map((s) => s.trim()).filter((s) => /^[A-Za-z0-9-]{8,64}$/.test(s)).slice(0, 5);
  const names = (q.get('names') || '').split('|').map((s) => s.slice(0, 60)).slice(0, 5);
  const lat = Number(q.get('lat'));
  const lng = Number(q.get('lng'));
  const city = (q.get('city') || '').slice(0, 60);
  const state = (q.get('state') || '').slice(0, 2);
  if (!ids.length || !city || !Number.isFinite(lat) || !Number.isFinite(lng)) return Response.json({ error: 'Missing city or artists.' }, { status: 400 });
  try {
    const detail = await buildCityDetail({ ids, seedNames: names, cityId, city, state, lat, lng, genre: q.get('genre') || null });
    return Response.json(detail, { headers: { 'Cache-Control': 'private, max-age=600' } });
  } catch (e: any) {
    return Response.json({ error: String(e?.message || 'Could not load this city.').slice(0, 200) }, { status: 502 });
  }
}
