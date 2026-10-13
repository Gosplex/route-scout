'use client';
import dynamic from 'next/dynamic';
import type { Artist, HeatPoint, TraceEvent } from '@/lib/types';
import { initials } from './client';

const Globe = dynamic(() => import('./Globe'), { ssr: false });

export default function Soundcheck({
  trace,
  heat,
  artists,
  error,
  onBack,
}: {
  trace: TraceEvent[];
  heat: HeatPoint[];
  artists: Artist[];
  error: string | null;
  onBack: () => void;
}) {
  const doneCount = trace.filter((t) => t.status !== 'running').length;
  return (
    <main className="screen">
      <div className="brandbar">
        <img className="lockup" src="/logo-lockup.webp" alt="Route Scout" width={125} height={34} />
        <button className="btn small" onClick={onBack}>
          Cancel
        </button>
      </div>
      <div className="soundcheck">
        <div className="globe-wrap">
          <Globe heat={heat} phase={heat.length ? 2 : doneCount ? 1 : 0} />
        </div>
        <section aria-live="polite">
          <h2 className="display">Soundcheck</h2>
          <p className="sub">Finding your people. This takes about 20 seconds.</p>
          {artists.length > 0 && (
            <div className="seed-row">
              {artists.map((a) => (
                <span className="chip" key={a.id}>
                  {a.image ? <img className="avatar" src={a.image} alt="" /> : <span className="avatar">{initials(a.name)}</span>}
                  {a.name}
                </span>
              ))}
            </div>
          )}
          <ul className="checklist">
            {trace.map((t) => (
              <li key={t.id}>
                <span className={t.status === 'running' ? 'icon-run' : t.status === 'done' ? 'icon-done' : t.status === 'warn' ? 'icon-warn' : 'icon-err'} aria-hidden="true">
                  {t.status === 'done' ? '✓' : t.status === 'warn' ? '!' : t.status === 'error' ? '×' : ''}
                </span>
                <div>
                  <div className="t-label">
                    {t.label}
                    {t.ms !== undefined && t.status !== 'running' && <span className="t-ms">{(t.ms / 1000).toFixed(1)}s</span>}
                  </div>
                  {t.detail && <div className="t-detail">{t.detail}</div>}
                </div>
              </li>
            ))}
            {!trace.length && !error && (
              <li>
                <span className="icon-run" aria-hidden="true" />
                <div className="t-label">Waking up the agent</div>
              </li>
            )}
          </ul>
          {error && (
            <div className="error-box" role="alert" style={{ marginLeft: 0 }}>
              {error}
              <div style={{ marginTop: 10 }}>
                <button className="btn small" onClick={onBack}>
                  Back to the start
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
