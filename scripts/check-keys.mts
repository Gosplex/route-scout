/** npm run check:keys  -> confirms each API key works before you deploy. */
import { loadEnv } from './env.mts';
loadEnv();

const out: [string, boolean, string][] = [];

async function check(name: string, fn: () => Promise<string>) {
  try {
    out.push([name, true, await fn()]);
  } catch (e: any) {
    out.push([name, false, String(e?.message || e).slice(0, 160)]);
  }
}

await check('Qloo', async () => {
  if (!process.env.QLOO_API_KEY) throw new Error('QLOO_API_KEY missing');
  const base = (process.env.QLOO_BASE_URL || 'https://hackathon.api.qloo.com').replace(/\/$/, '');
  const r = await fetch(`${base}/search?query=Bon%20Iver&types=urn:entity:artist&take=1`, { headers: { 'X-Api-Key': process.env.QLOO_API_KEY } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j: any = await r.json();
  const first = (Array.isArray(j.results) ? j.results : j.results?.entities || [])[0];
  return `found ${first?.name || 'nothing'}`;
});

await check('Ticketmaster', async () => {
  if (!process.env.TICKETMASTER_API_KEY) throw new Error('TICKETMASTER_API_KEY missing (optional, but needed for show counts)');
  const r = await fetch(`https://app.ticketmaster.com/discovery/v2/events.json?city=Chicago&segmentName=Music&size=1&apikey=${process.env.TICKETMASTER_API_KEY}`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j: any = await r.json();
  return `${j?.page?.totalElements ?? 0} music events listed in Chicago`;
});

await check('OpenRouter', async () => {
  if (!process.env.OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY missing (optional; agent runs on autopilot without it)');
  const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini',
      messages: [{ role: 'user', content: 'Reply with the single word: ready' }],
      max_tokens: 5,
    }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 120)}`);
  const j: any = await r.json();
  return `${j.model} says "${j.choices?.[0]?.message?.content?.trim()}"`;
});

for (const [name, ok, msg] of out) console.log(`${ok ? '✅' : '❌'} ${name.padEnd(12)} ${msg}`);
process.exit(out[0][1] ? 0 : 1);
