import planJson from '@/data/demo/plan.json';
import detailsJson from '@/data/demo/details.json';
import type { CityDetail, StreamMessage, TourPlan } from './types';

export const DEMO_ARTISTS = ['Bon Iver', 'Fleet Foxes', 'Phoebe Bridgers'];

export function demoPlan(): TourPlan {
  return JSON.parse(JSON.stringify(planJson)) as TourPlan;
}

export function demoDetail(cityId: string): CityDetail | null {
  const all = detailsJson as unknown as Record<string, CityDetail>;
  return all[cityId] ? JSON.parse(JSON.stringify(all[cityId])) : null;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Replays the demo run with the same trace steps a live run produces. */
export async function replayDemo(emit: (m: StreamMessage) => void) {
  const plan = demoPlan();
  const hidden = plan.stops.find((s) => s.id === plan.hiddenCityId);
  const pool = plan.candidates.slice(0, 12);
  const live = !!(plan as any).recordedAt;
  const steps: { label: string; detail: string; ms: number; after?: () => void }[] = [
    {
      label: `Matching ${plan.artists.map((a) => a.name).join(', ')} in Qloo`,
      detail: `Found ${plan.artists.map((a) => a.name).join(', ')}`,
      ms: 700,
      after: () => emit({ type: 'artists', artists: plan.artists }),
    },
    {
      label: 'Scanning the US taste map',
      detail: `${plan.heat.length.toLocaleString()} map cells scored across ${plan.candidates.length}+ cities`,
      ms: 1500,
      after: () => emit({ type: 'heat', heat: plan.heat.filter((_, i) => i % 2 === 0) }),
    },
    {
      label: `Counting upcoming ${plan.genre || 'music'} shows in ${pool.length} cities`,
      detail: hidden ? `Least crowded: ${hidden.name}, ${hidden.state} (${hidden.genreShows} similar shows in 6 months)` : 'Done',
      ms: 1300,
    },
    { label: 'Checking where similar artists already have dates', detail: 'Overlaps checked against your top cities', ms: 800 },
    { label: 'Asking a plain AI (no data) where to tour', detail: `It suggests ${plan.baseline.names.slice(0, 6).join(', ')}`, ms: 900 },
    {
      label: `Planning a ${plan.stops.length}-stop route`,
      detail: plan.stops.map((s) => s.name).join(' → '),
      ms: 800,
    },
  ];
  emit({ type: 'trace', event: { id: 'd0', label: live ? 'Replaying a recorded live run' : 'Demo with sample data', status: 'done', detail: live ? `Recorded ${(plan as any).recordedAt}` : 'Add API keys for live results' } });
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    const id = `d${i + 1}`;
    emit({ type: 'trace', event: { id, label: s.label, status: 'running' } });
    await wait(s.ms);
    emit({ type: 'trace', event: { id, label: s.label, status: 'done', detail: s.detail, ms: s.ms } });
    s.after?.();
  }
  emit({ type: 'result', plan });
}
