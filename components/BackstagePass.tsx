'use client';
import { useEffect, useRef } from 'react';
import type { CityDetail, Stop, TourPlan } from '@/lib/types';
import { fmtDate, initials } from './client';

const BARS = 16;
const barColor = (i: number) => {
  const t = i / (BARS - 1);
  if (t > 0.8) return 'var(--amber)';
  if (t > 0.45) return 'var(--magenta)';
  return 'var(--cyan)';
};

export default function BackstagePass({
  plan,
  stop,
  detail,
  error,
  onClose,
  onRetry,
}: {
  plan: TourPlan;
  stop: Stop;
  detail: CityDetail | null;
  error: string | null;
  onClose: () => void;
  onRetry: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const hidden = stop.id === plan.hiddenCityId;
  const date = fmtDate(stop.date);
  const lit = stop.room !== undefined ? Math.max(1, Math.round(stop.room * BARS)) : 0;
  const crowded = plan.candidates.filter((c) => c.genreShows !== undefined).sort((a, b) => (b.genreShows ?? 0) - (a.genreShows ?? 0))[0];
  const genre = plan.genre ? plan.genre.toLowerCase() : 'similar';
  const isShared = plan.id === 'shared';

  return (
    <div className="modal-bg" role="dialog" aria-modal="true" aria-labelledby="pass-title" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <article className="bpass">
        <button ref={closeRef} className="btn small close" onClick={onClose}>
          Close
        </button>
        <div className="head">
          <div>
            <div className="pass-who" style={{ color: hidden ? 'var(--amber)' : 'var(--magenta)', fontWeight: 700 }}>
              {hidden ? 'Your hidden city' : `Stop ${stop.order} of ${plan.stops.length}`}
            </div>
            <h2 id="pass-title" className="display city">
              {stop.name}
            </h2>
            <div className="when">
              {date.long}, {stop.state}
            </div>
          </div>
          {stop.score !== undefined && stop.score > 0 && (
            <div style={{ textAlign: 'right' }}>
              <div className="display" style={{ fontSize: 64, color: 'var(--cyan)' }}>
                {stop.score}
              </div>
              <div className="note">Route Scout score</div>
            </div>
          )}
        </div>

        {isShared ? (
          <p className="crowdline">This is a shared tour. Plan your own to see the crowd, venues and support acts for each city.</p>
        ) : error ? (
          <div className="error-box" style={{ marginLeft: 0 }}>
            {error}{' '}
            <button className="linkish" onClick={onRetry}>
              Try again
            </button>
          </div>
        ) : !detail ? (
          <div style={{ display: 'grid', gap: 10, marginTop: 18 }} aria-busy="true">
            <div className="skeleton" style={{ width: '80%' }} />
            <div className="skeleton" style={{ width: '60%' }} />
            <div className="skeleton" style={{ height: 80 }} />
            <div className="skeleton" style={{ height: 80 }} />
          </div>
        ) : (
          <>
            <p className="crowdline">{detail.crowdLine}</p>

            <section>
              <h3>Your crowd</h3>
              <div className="collage">
                {detail.tags.slice(0, 5).map((t) => (
                  <div className="tile tagt" key={'t' + t}>
                    <span>{t}</span>
                    <em>taste</em>
                  </div>
                ))}
                {detail.brands.slice(0, 5).map((b) => (
                  <div className="tile brand" key={'b' + b.name} title={b.why}>
                    {b.image && <img src={b.image} alt="" loading="lazy" />}
                    <span>{b.name}</span>
                    <em>brand they love</em>
                  </div>
                ))}
                {detail.hangouts.slice(0, 4).map((h) => (
                  <div className="tile hang" key={'h' + h.name}>
                    {h.image && <img src={h.image} alt="" loading="lazy" />}
                    <span>{h.name}</span>
                    <em>hangout</em>
                  </div>
                ))}
              </div>
              {plan.audience && <AudienceLine plan={plan} />}
            </section>

            <section>
              <h3>Room to grow</h3>
              {stop.room !== undefined ? (
                <>
                  <div className="vu" aria-hidden="true">
                    {Array.from({ length: BARS }, (_, i) => (
                      <i
                        key={i}
                        className={i < lit ? 'on' : ''}
                        style={{
                          height: `${30 + (i / BARS) * 70}%`,
                          background: i < lit ? barColor(i) : undefined,
                          boxShadow: i < lit ? `0 0 10px ${barColor(i)}` : undefined,
                          animationDelay: `${i * 60}ms`,
                        }}
                      />
                    ))}
                  </div>
                  <p style={{ margin: 0 }}>
                    <b>{stop.genreShows}</b> ticketed {genre} shows are booked within 35 miles in the next six months
                    {crowded && crowded.id !== stop.id ? `, compared with ${crowded.genreShows} in ${crowded.name}` : ''}.
                  </p>
                </>
              ) : (
                <p className="note" style={{ margin: 0 }}>
                  Show counts weren’t available for this run, so this city was scored on taste and route only.
                </p>
              )}
              {stop.similarBooked?.length ? (
                <p className="note" style={{ marginBottom: 0 }}>
                  Already booked nearby: {stop.similarBooked.map((b) => `${b.artist} on ${fmtDate(b.date).m} ${fmtDate(b.date).d}${b.venue ? ` at ${b.venue}` : ''}`).join('; ')}.
                </p>
              ) : null}
            </section>

            <section>
              <h3>Where to play</h3>
              {detail.venues.length ? (
                <div className="rows">
                  {detail.venues.map((v) => (
                    <div className="row" key={v.name}>
                      <span className="ph" aria-hidden="true">
                        {initials(v.name)}
                      </span>
                      <div className="main">
                        <b>{v.url ? <a href={v.url} target="_blank" rel="noreferrer">{v.name}</a> : v.name}</b>
                        <small>{v.shows ? `${v.shows} upcoming ${v.shows === 1 ? 'show' : 'shows'} in this genre` : 'Live music venue'}</small>
                      </div>
                      <span className="badge src">{v.source === 'both' ? 'Ticketmaster + Qloo' : v.source === 'qloo' ? 'Qloo' : 'Ticketmaster'}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="note">No venues with upcoming ticketed shows in this genre turned up. Check the hangouts above for rooms that host live music.</p>
              )}
            </section>

            <section>
              <h3>Who to play with</h3>
              <div className="rows">
                {detail.supportActs.map((a) => (
                  <div className="row" key={a.id}>
                    {a.image ? <img src={a.image} alt="" loading="lazy" /> : <span className="ph">{initials(a.name)}</span>}
                    <div className="main">
                      <b>{a.name}</b>
                      <small>{a.why || 'Shares your audience here'}</small>
                    </div>
                    {a.rising && <span className="badge rising">Rising</span>}
                  </div>
                ))}
              </div>
            </section>

            <section>
              <h3>Why this city</h3>
              <div className="bars3">
                <Bar label="Taste match" value={Math.max(1, 100 - stop.topPercent)} caption={`top ${stop.topPercent}%`} />
                {stop.room !== undefined && <Bar label="Room to grow" value={Math.round(stop.room * 100)} />}
                {stop.fit !== undefined && <Bar label="Route fit" value={Math.round(stop.fit * 100)} />}
              </div>
              {detail.brands.find((b) => b.why) && <p className="note">{detail.brands.find((b) => b.why)?.why} drives this city’s taste profile.</p>}
            </section>

            <p className="note" style={{ marginTop: 22 }}>
              {detail.demo ? 'Sample data for the demo. Live runs use Qloo and Ticketmaster.' : `Taste from Qloo${detail.sources.ticketmaster ? ', shows and venues from Ticketmaster' : ''}${detail.sources.ai ? ', crowd summary written by AI from that data' : ''}.`}
            </p>
          </>
        )}
      </article>
    </div>
  );
}

function Bar({ label, value, caption }: { label: string; value: number; caption?: string }) {
  return (
    <div className="bar3">
      <span>{label}</span>
      <span className="track">
        <span className="fill" style={{ width: `${Math.min(100, Math.max(2, value))}%`, display: 'block' }} />
      </span>
      <span className="v">{caption || value}</span>
    </div>
  );
}

function AudienceLine({ plan }: { plan: TourPlan }) {
  const a = plan.audience;
  if (!a) return null;
  const ageLabels: Record<string, string> = { '24_and_younger': 'under 25', '25_to_29': '25 to 29', '30_to_34': '30 to 34', '35_to_44': '35 to 44', '45_to_54': '45 to 54', '55_and_older': '55+' };
  const topAge = Object.entries(a.age).sort((x, y) => y[1] - x[1])[0];
  const g = a.gender.female > 0.1 ? 'leans female' : a.gender.male > 0.1 ? 'leans male' : 'is evenly split';
  return (
    <p className="note" style={{ marginBottom: 0 }}>
      Across the US, your kind of audience {g} and peaks at {ageLabels[topAge?.[0]] || 'under 35'}.
    </p>
  );
}
