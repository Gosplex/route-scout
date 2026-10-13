/**
 * npm run snapshot
 * Records a REAL run (Qloo + Ticketmaster + OpenRouter) for the demo button, so judges
 * always get instant, live-quality data even if an API is slow on judging day.
 *
 * Optional args: npm run snapshot -- "Artist 1" "Artist 2" "Artist 3"
 */
import { writeFileSync } from 'node:fs';
import { loadEnv } from './env.mts';
loadEnv();

const { runAgent } = await import('../lib/agent');
const { buildCityDetail } = await import('../lib/detail');

const artists = process.argv.slice(2).filter((a) => a !== '--').length ? process.argv.slice(2).filter((a) => a !== '--') : ['Bon Iver', 'Fleet Foxes', 'Phoebe Bridgers'];
console.log('Recording a live run for:', artists.join(', '));

const plan: any = await runAgent(
  { artists, sound: 'moody indie-folk with big harmonies', actName: 'The Low Pines', stops: 6, home: 'Portland, OR' },
  (m) => {
    if (m.type === 'trace' && m.event.status !== 'running') console.log(` ${m.event.status === 'done' ? '✓' : '!'} ${m.event.label}${m.event.detail ? ' — ' + m.event.detail : ''}`);
  },
);
plan.demo = true;
plan.id = 'demo';
plan.recordedAt = new Date().toISOString().slice(0, 10);

const details: Record<string, any> = {};
for (const s of plan.stops) {
  console.log(` … city detail: ${s.name}`);
  details[s.id] = await buildCityDetail({
    ids: plan.artists.map((a: any) => a.id),
    seedNames: plan.artists.map((a: any) => a.name),
    cityId: s.id,
    city: s.name,
    state: s.state,
    lat: s.lat,
    lng: s.lng,
    genre: plan.genre,
  });
}

writeFileSync('data/demo/plan.json', JSON.stringify(plan));
writeFileSync('data/demo/details.json', JSON.stringify(details));
console.log(`\nSaved. Hidden city: ${plan.stops.find((s: any) => s.id === plan.hiddenCityId)?.name}. Commit data/demo/*.json and redeploy.`);
