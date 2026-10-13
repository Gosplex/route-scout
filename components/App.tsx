'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import type { Artist, HeatPoint, TourPlan, TraceEvent } from '@/lib/types';
import Landing, { emptyForm, type FormState } from './Landing';
import MapStage from './MapStage';
import Soundcheck from './Soundcheck';
import StageLights from './StageLights';
import { planFromShare, streamAgent } from './client';
import { track } from './track';

type Phase = 'stage' | 'soundcheck' | 'show';
type Health = { qloo: boolean; ticketmaster: boolean; ai: boolean } | null;

export default function App() {
  const params = useSearchParams();
  const [phase, setPhase] = useState<Phase>('stage');
  const [form, setForm] = useState<FormState>(emptyForm);
  const formRef = useRef(form);
  formRef.current = form;
  const [health, setHealth] = useState<Health>(null);
  const [trace, setTrace] = useState<TraceEvent[]>([]);
  const [heat, setHeat] = useState<HeatPoint[]>([]);
  const [artists, setArtists] = useState<Artist[]>([]);
  const [plan, setPlan] = useState<TourPlan | null>(null);
  const [reveal, setReveal] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => setHealth({ qloo: false, ticketmaster: false, ai: false }));
  }, []);

  // Shared tour links open straight on the map
  useEffect(() => {
    const token = params.get('tour');
    if (!token) return;
    const shared = planFromShare(token);
    if (shared) {
      setPlan(shared);
      setReveal(false);
      setPhase('show');
    }
  }, [params]);

  const run = useCallback(async (demo: boolean) => {
    const f = formRef.current;
    track(demo ? 'demo_started' : 'tour_started');
    if (!demo && !f.seeds.length) {
      setError('Add at least one artist you sound like.');
      return;
    }
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setError(null);
    setTrace([]);
    setHeat([]);
    setArtists([]);
    setPlan(null);
    setPhase('soundcheck');
    const startedAt = Date.now();
    try {
      await streamAgent(
        demo
          ? { demo: true }
          : { artists: f.seeds.map((s) => s.name), sound: f.sound, actName: f.actName, home: f.home, stops: f.stops, startDate: f.startDate },
        (m) => {
          if (m.type === 'trace') {
            setTrace((list) => {
              const i = list.findIndex((t) => t.id === m.event.id);
              if (i < 0) return [...list, m.event];
              const copy = [...list];
              copy[i] = m.event;
              return copy;
            });
          } else if (m.type === 'heat') setHeat(m.heat);
          else if (m.type === 'artists') setArtists(m.artists);
          else if (m.type === 'error') throw new Error(m.message);
          else if (m.type === 'result') {
            const wait = Math.max(0, 1400 - (Date.now() - startedAt));
            window.setTimeout(() => {
              if (ctrl.signal.aborted) return;
              track('tour_ready', ['hidden_city', m.plan.stops.find((s) => s.id === m.plan.hiddenCityId)?.name || 'none']);
              setPlan(m.plan);
              setReveal(true);
              setPhase('show');
            }, wait + 900);
          }
        },
        ctrl.signal,
      );
    } catch (e: any) {
      if (ctrl.signal.aborted) return;
      track('tour_failed');
      setError(e?.message || 'Something went wrong while planning.');
    }
  }, []);

  const reset = () => {
    abort.current?.abort();
    setPhase('stage');
    setPlan(null);
    setError(null);
    if (params.get('tour')) window.history.replaceState(null, '', '/');
  };

  return (
    <>
      {phase !== 'show' && <StageLights dim={phase === 'soundcheck'} />}
      {phase === 'stage' && (
        <Landing form={form} setForm={setForm} onStart={() => run(false)} onDemo={() => run(true)} error={error} health={health} busy={false} />
      )}
      {phase === 'soundcheck' && <Soundcheck trace={trace} heat={heat} artists={artists} error={error} onBack={reset} />}
      {phase === 'show' && plan && <MapStage plan={plan} setPlan={setPlan} startWithReveal={reveal} onNew={reset} />}
    </>
  );
}
