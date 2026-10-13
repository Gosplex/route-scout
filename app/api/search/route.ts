import { hasQloo, searchArtists } from '@/lib/qloo';
import { allow, ipOf } from '@/lib/ratelimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const q = (new URL(req.url).searchParams.get('q') || '').trim().slice(0, 60);
  if (q.length < 2 || !hasQloo()) return Response.json({ results: [] });
  if (!allow(ipOf(req), 120, 60_000)) return Response.json({ results: [] }, { status: 429 });
  try {
    return Response.json({ results: await searchArtists(q, 6) }, { headers: { 'Cache-Control': 'private, max-age=3600' } });
  } catch {
    return Response.json({ results: [] });
  }
}
