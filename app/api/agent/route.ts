import { runAgent } from '@/lib/agent';
import { replayDemo } from '@/lib/demo';
import { hasQloo } from '@/lib/qloo';
import { allow, ipOf } from '@/lib/ratelimit';
import type { AgentInput, StreamMessage } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const clean = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max) : undefined);

export async function POST(req: Request) {
  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Send JSON.' }, { status: 400 });
  }
  const demo = body?.demo === true;
  const input: AgentInput = {
    artists: Array.isArray(body?.artists) ? body.artists.map((a: unknown) => clean(a, 60)).filter(Boolean).slice(0, 5) : [],
    sound: clean(body?.sound, 140),
    actName: clean(body?.actName, 40),
    home: clean(body?.home, 60),
    stops: Number(body?.stops) || 6,
    startDate: clean(body?.startDate, 10),
  };
  if (!demo && !input.artists.length) return Response.json({ error: 'Add at least one artist you sound like.' }, { status: 400 });
  if (!demo && !hasQloo()) return Response.json({ error: 'Live mode needs QLOO_API_KEY on the server. Try the demo for now.' }, { status: 503 });
  const limit = Number(process.env.RATE_LIMIT_PER_10MIN) || 8;
  const isLocalDev = process.env.NODE_ENV === 'development';
  if (!demo && !isLocalDev && !allow(ipOf(req), limit, 10 * 60_000)) return Response.json({ error: 'Too many tours planned from here. Wait a few minutes and try again.' }, { status: 429 });

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let open = true;
      const emit = (m: StreamMessage) => {
        if (!open) return;
        try {
          controller.enqueue(enc.encode(`data: ${JSON.stringify(m)}\n\n`));
        } catch {
          open = false;
        }
      };
      const ping = setInterval(() => open && controller.enqueue(enc.encode(': ping\n\n')), 10_000);
      try {
        if (demo) await replayDemo(emit);
        else emit({ type: 'result', plan: await runAgent(input, emit) });
      } catch (e: any) {
        emit({ type: 'error', message: String(e?.message || 'Something went wrong while planning.').slice(0, 300) });
      } finally {
        clearInterval(ping);
        open = false;
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' },
  });
}
