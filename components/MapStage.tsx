'use client';
import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CityDetail, Stop, TourPlan } from '@/lib/types';
import BackstagePass from './BackstagePass';
import Encore from './Encore';
import { fmtDate, moveStop, swapStop } from './client';
import { track } from './track';
import type { Focus, MapMode } from './TourMap';

const TourMap = dynamic(() => import('./TourMap'), { ssr: false });

type Props = {
  plan: TourPlan;
  setPlan: (p: TourPlan) => void;
  startWithReveal: boolean;
  onNew: () => void;
};

export default function MapStage({ plan, setPlan, startWithReveal, onNew }: Props) {
  const hasHeat = plan.heat.length > 0;
  const [step, setStep] = useState<number>(startWithReveal && hasHeat ? 0 : 4); // 0 obvious, 1 blackout, 2 lights, 3 hidden card, 4 tour
  const [focus, setFocus] = useState<Focus>(null);
  const [showObvious, setShowObvious] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, CityDetail>>({});
  const [detailErr, setDetailErr] = useState<string | null>(null);
  const [encore, setEncore] = useState(false);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [panelSide, setPanelSide] = useState<'right' | 'bottom'>('right');
  const timers = useRef<number[]>([]);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 980px)');
    const set = () => setPanelSide(mq.matches ? 'bottom' : 'right');
    set();
    mq.addEventListener('change', set);
    return () => mq.removeEventListener('change', set);
  }, []);

  const hidden = plan.stops.find((s) => s.id === plan.hiddenCityId) || plan.candidates.find((c) => c.id === plan.hiddenCityId) || null;

  const runReveal = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setFocus({ lat: 38.6, lng: -97, zoom: window.innerWidth < 700 ? 2.55 : 3.3, pitch: 42, bearing: -8, key: 'reset' + Date.now() });
    if (reduce) {
      setStep(3);
      if (hidden) setFocus({ lat: hidden.lat, lng: hidden.lng, zoom: 5.4, key: 'hidden' + Date.now() });
      return;
    }
    setStep(0);
    // Presenter tip: add ?slowmo=2 to the URL to slow the reveal down on stage.
    const pace = Math.min(6, Math.max(1, Number(new URLSearchParams(window.location.search).get('slowmo')) || 1));
    const at = (ms: number, fn: () => void) => timers.current.push(window.setTimeout(fn, ms * pace));
    at(2900, () => setStep(1));
    at(3800, () => setStep(2));
    at(6400, () => {
      setStep(3);
      if (hidden) setFocus({ lat: hidden.lat - 0.6, lng: hidden.lng, zoom: window.innerWidth < 700 ? 4.6 : 5.4, pitch: 58, bearing: -14, key: 'hidden' + Date.now() });
    });
  }, [hidden]);

  useEffect(() => {
    if (step === 0 && startWithReveal && hasHeat) runReveal();
    return () => timers.current.forEach(clearTimeout);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const toTour = () => {
    timers.current.forEach(clearTimeout);
    setStep(4);
  };

  const mode: MapMode = step === 0 ? 'obvious' : step < 4 ? 'lights' : 'tour';

  // --------------------------------------------------- city detail
  const openStop = openId ? plan.stops.find((s) => s.id === openId) || null : null;
  const loadDetail = useCallback(
    async (s: Stop) => {
      setDetailErr(null);
      if (plan.id === 'shared' || details[s.id]) return;
      const qs = plan.demo
        ? `demo=1&cityId=${encodeURIComponent(s.id)}`
        : new URLSearchParams({
            cityId: s.id,
            city: s.name,
            state: s.state,
            lat: String(s.lat),
            lng: String(s.lng),
            ids: plan.artists.map((a) => a.id).join(','),
            names: plan.artists.map((a) => a.name).join('|'),
            genre: plan.genre || '',
          }).toString();
      try {
        const r = await fetch(`/api/city?${qs}`);
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || 'Could not load this city.');
        setDetails((d) => ({ ...d, [s.id]: j }));
      } catch (e: any) {
        setDetailErr(e.message || 'Could not load this city.');
      }
    },
    [plan, details],
  );

  const open = (id: string) => {
    track('city_opened');
    setSelected(id);
    setOpenId(id);
    const s = plan.stops.find((x) => x.id === id);
    if (s) loadDetail(s);
  };

  // Prefetch the hidden city so the first pass opens instantly
  useEffect(() => {
    const h = plan.stops.find((s) => s.id === plan.hiddenCityId);
    if (h) loadDetail(h);
  }, [plan.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // --------------------------------------------------- edits
  const say = (t: string) => {
    setToast(t);
    window.setTimeout(() => setToast(null), 2200);
  };
  const doMove = (from: number, to: number) => {
    if (to < 0 || to >= plan.stops.length || from === to) return;
    setPlan({ ...plan, stops: moveStop(plan, from, to) });
  };
  const doSwap = (i: number) => {
    const next = swapStop(plan, i);
    if (!next) return say('No more strong cities nearby to swap in');
    const removed = plan.stops[i];
    const added = next.find((s) => !plan.stops.some((p) => p.id === s.id));
    const hiddenStill = next.some((s) => s.id === plan.hiddenCityId);
    setPlan({ ...plan, stops: next, hiddenCityId: hiddenStill ? plan.hiddenCityId : added?.id || plan.hiddenCityId });
    say(`Swapped ${removed.name} for ${added?.name || 'a new city'}`);
  };

  const totalKm = useMemo(() => plan.stops.reduce((s, x) => s + x.legKm, 0), [plan.stops]);
  const readOnly = plan.id === 'shared';

  return (
    <div className="mapstage">
      <TourMap
        plan={plan}
        stops={plan.stops}
        mode={mode}
        showObvious={showObvious}
        selectedId={selected}
        onSelect={open}
        focus={focus}
        panelSide={step === 4 ? panelSide : 'none'}
      />

      <div className="topbar">
        <img className="mark" src="/mark.webp" alt="Route Scout" width={40} height={40} />
        {step === 4 && <div className="headline">{plan.headline}</div>}
        <div className="spacer" />
        {step === 4 && !readOnly && plan.baseline.cities.length > 0 && (
          <button className="btn small" aria-pressed={showObvious} onClick={() => setShowObvious((v) => !v)}>
            Plain AI picks
          </button>
        )}
        {step === 4 && hasHeat && (
          <button className="btn small" onClick={runReveal}>
            Replay reveal
          </button>
        )}
        <button className="btn small" onClick={onNew}>
          {readOnly ? 'Plan your own' : 'New tour'}
        </button>
      </div>

      {(plan.demo || readOnly) && step === 4 && (
        <div className="banner" role="note">
          {readOnly ? 'A shared tour. Plan your own in under a minute.' : (plan as any).recordedAt ? 'Demo: a recorded live run' : 'Demo with sample data. Add API keys for live results.'}
        </div>
      )}

      {/* ---------------- reveal overlays ---------------- */}
      {step < 4 && (
        <>
          <div className="blackout" style={{ opacity: step === 1 ? 0.88 : 0 }} />
          <div className={`spot a ${step === 2 ? 'sweep' : step === 3 ? 'land' : ''}`} aria-hidden="true" />
          <div className={`spot b ${step === 2 ? 'sweep' : step === 3 ? 'land' : ''}`} aria-hidden="true" />
          <div className="reveal-caption" style={{ opacity: step === 0 ? 1 : 0 }} aria-live="polite">
            <div className="kicker">{plan.baseline.source === 'ai' ? 'Ask a plain AI where to tour and it says:' : 'The usual advice says:'}</div>
            <div className="display big">The obvious cities</div>
            <div className="names">
              {plan.baseline.names.slice(0, 8).map((n) => (
                <span key={n}>{n}</span>
              ))}
            </div>
          </div>
          <div className="reveal-caption" style={{ opacity: step === 1 || step === 2 ? 1 : 0 }}>
            <div className="kicker">Now with real taste data</div>
            <div className="display big">Lights down</div>
          </div>
          {step === 3 && hidden && (
            <div className="hidden-card">
              <div className="pass">
                <div className="who">Your hidden city</div>
                <div className="display city">{hidden.name}</div>
                <div className="state">{hidden.state}</div>
                <ul className="facts">
                  <li>
                    <span className="n amber">{hidden.topPercent}%</span>
                    <span>Top of US cities for fans of {plan.artists.map((a) => a.name).join(', ')}</span>
                  </li>
                  {hidden.genreShows !== undefined && (
                    <li>
                      <span className="n">{hidden.genreShows}</span>
                      <span>Ticketed {plan.genre ? plan.genre.toLowerCase() : 'similar'} shows booked here in the next 6 months</span>
                    </li>
                  )}
                  <li>
                    <span className="n">{plan.baseline.names.length}</span>
                    <span>Cities the plain AI suggested. This wasn’t one of them.</span>
                  </li>
                </ul>
                <div className="actions">
                  <button className="btn primary" onClick={toTour} autoFocus>
                    See my tour
                  </button>
                  <button className="btn" onClick={runReveal}>
                    Replay
                  </button>
                </div>
              </div>
            </div>
          )}
          {step < 3 && (
            <button className="btn small skip" onClick={toTour}>
              Skip to tour
            </button>
          )}
        </>
      )}

      {/* ---------------- tour panel ---------------- */}
      {step === 4 && (
        <>
          <aside className="setlist" aria-label="Tour setlist">
            <header>
              <div className="display act">{plan.actName}</div>
              <div className="meta">
                {plan.stops.length} shows, {totalKm.toLocaleString()} km of driving{plan.home ? ` from ${plan.home.name}` : ''}
              </div>
            </header>
            <ol>
              {plan.stops.map((s, i) => {
                const f = fmtDate(s.date);
                const isHidden = s.id === plan.hiddenCityId;
                return (
                  <li key={s.id}>
                    {i > 0 && (
                      <div className="leg">
                        {s.legKm.toLocaleString()} km, about {Math.round(s.legHours)} h on the road
                      </div>
                    )}
                    <div
                      className={`stop${isHidden ? ' hidden-city' : ''}${selected === s.id ? ' selected' : ''}${dragFrom === i ? ' dragging' : ''}`}
                      draggable={!readOnly}
                      onDragStart={() => setDragFrom(i)}
                      onDragEnd={() => setDragFrom(null)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => {
                        if (dragFrom !== null) doMove(dragFrom, i);
                        setDragFrom(null);
                      }}
                      onClick={() => open(s.id)}
                      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), open(s.id))}
                      role="button"
                      tabIndex={0}
                      aria-label={`${s.name}, ${s.state}, ${f.long}. Open details`}
                    >
                      <div className="date">
                        <div className="m">{f.m}</div>
                        <div className="d">{f.d}</div>
                      </div>
                      <div>
                        <div className="name">
                          {s.name}
                          <small>{s.state}</small>
                        </div>
                        <div className="sub">
                          Top {s.topPercent}% for your sound
                          {s.genreShows !== undefined ? `, ${s.genreShows} similar shows booked` : ''}
                        </div>
                        {isHidden && <span className="tag">Hidden city</span>}
                      </div>
                      <div>
                        {s.score ? (
                          <div className="score">
                            {s.score}
                            <small>score</small>
                          </div>
                        ) : null}
                        {!readOnly && (
                          <div className="tools" onClick={(e) => e.stopPropagation()}>
                            <button className="iconbtn" aria-label={`Move ${s.name} earlier`} disabled={i === 0} onClick={() => doMove(i, i - 1)}>
                              ↑
                            </button>
                            <button className="iconbtn" aria-label={`Move ${s.name} later`} disabled={i === plan.stops.length - 1} onClick={() => doMove(i, i + 1)}>
                              ↓
                            </button>
                            <button className="iconbtn" aria-label={`Swap ${s.name} for another city`} onClick={() => doSwap(i)}>
                              ⇄
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
            <footer>
              {plan.summary && <p style={{ margin: 0, fontSize: 14, color: '#d9d6ea' }}>{plan.summary}</p>}
              {plan.audience && <AudienceBars audience={plan.audience} />}
              <button className="btn amber" style={{ justifyContent: 'center', fontSize: 17, padding: '13px 16px' }} onClick={() => {
                  track('tour_locked');
                  setEncore(true);
                }}>
                Lock the tour
              </button>
            </footer>
          </aside>
          <div className="legend" aria-hidden="true">
            <span>
              <i style={{ background: 'var(--amber)' }} />
              Strongest taste
            </span>
            <span>
              <i style={{ background: 'var(--magenta)' }} />
              Strong
            </span>
            <span>
              <i style={{ background: 'var(--cyan)' }} />
              Some
            </span>
          </div>
          {!readOnly && <div className="attrib">Taste data from Qloo. Show counts from Ticketmaster.</div>}
        </>
      )}

      {openStop && (
        <BackstagePass
          plan={plan}
          stop={openStop}
          detail={details[openStop.id] || null}
          error={detailErr}
          onClose={() => setOpenId(null)}
          onRetry={() => loadDetail(openStop)}
        />
      )}
      {encore && <Encore plan={plan} onClose={() => setEncore(false)} />}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

function AudienceBars({ audience }: { audience: NonNullable<TourPlan['audience']> }) {
  const keys = ['24_and_younger', '25_to_29', '30_to_34', '35_to_44', '45_to_54', '55_and_older'];
  const labels = ['<25', '25-29', '30-34', '35-44', '45-54', '55+'];
  const vals = keys.map((k) => audience.age[k] ?? 0);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const female = audience.gender.female ?? 0;
  return (
    <div className="aud">
      <span>
        Your audience by age{female > 0.1 ? ', leaning female' : female < -0.1 ? ', leaning male' : ''}
      </span>
      <div className="bars" aria-hidden="true">
        {vals.map((v, i) => (
          <div key={i} style={{ height: `${10 + ((v - min) / Math.max(0.01, max - min)) * 90}%` }} />
        ))}
      </div>
      <div className="labels" aria-hidden="true">
        {labels.map((l) => (
          <span key={l}>{l}</span>
        ))}
      </div>
    </div>
  );
}
