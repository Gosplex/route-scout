'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { defaultStartDate } from '@/lib/geo';
import { initials } from './client';

export type Seed = { name: string; image?: string; id?: string };
export type FormState = {
  seeds: Seed[];
  sound: string;
  actName: string;
  home: string;
  stops: number;
  startDate: string;
};

export const emptyForm = (): FormState => ({ seeds: [], sound: '', actName: '', home: '', stops: 6, startDate: defaultStartDate() });

type Health = { qloo: boolean; ticketmaster: boolean; ai: boolean } | null;

export default function Landing({
  form,
  setForm,
  onStart,
  onDemo,
  error,
  health,
  busy,
}: {
  form: FormState;
  setForm: (f: FormState) => void;
  onStart: () => void;
  onDemo: () => void;
  error: string | null;
  health: Health;
  busy: boolean;
}) {
  const [text, setText] = useState('');
  const [results, setResults] = useState<Seed[]>([]);
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  useEffect(() => {
    const q = text.trim();
    if (q.length < 2 || !health?.qloo) {
      setResults([]);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
        const j = await r.json();
        setResults(j.results || []);
        setActive(0);
        setOpen(true);
      } catch {
        /* typing again cancels */
      }
    }, 220);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [text, health?.qloo]);

  const add = (seed: Seed) => {
    const name = seed.name.trim();
    if (!name || form.seeds.length >= 5 || form.seeds.some((s) => s.name.toLowerCase() === name.toLowerCase())) return;
    setForm({ ...form, seeds: [...form.seeds, { ...seed, name }] });
    setText('');
    setResults([]);
    setOpen(false);
    inputRef.current?.focus();
  };
  const remove = (i: number) => setForm({ ...form, seeds: form.seeds.filter((_, k) => k !== i) });

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' && results.length) {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(results.length - 1, a + 1));
    } else if (e.key === 'ArrowUp' && results.length) {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter' || e.key === ',' || e.key === 'Tab') {
      if (!text.trim()) {
        if (e.key === 'Enter' && form.seeds.length) {
          e.preventDefault();
          onStart();
        }
        return;
      }
      e.preventDefault();
      add(open && results[active] ? results[active] : { name: text });
    } else if (e.key === 'Backspace' && !text && form.seeds.length) {
      remove(form.seeds.length - 1);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  const liveReady = health?.qloo;

  return (
    <main className="screen landing">
      <div className="brandbar" style={{ position: 'absolute', top: 'calc(env(safe-area-inset-top, 0px) + 18px)', left: 24, right: 24 }}>
        <img className="lockup" src="/logo-lockup.webp" alt="Route Scout" width={125} height={34} />
        {health && (
          <span className="status-pill">
            {liveReady ? (
              <>
                Live data: <b>Qloo</b>
                {health.ticketmaster ? ' + Ticketmaster' : ''}
                {health.ai ? ' + AI agent' : ''}
              </>
            ) : (
              'Demo mode: live keys not set'
            )}
          </span>
        )}
      </div>

      <div className="landing-inner">
        <h1 className="display">
          Where are
          <span className="line2">your people?</span>
        </h1>
        <p className="lede">Name the artists you sound like. Route Scout finds the cities where your future fans already live, checks which ones aren’t packed with shows like yours, and plans the tour.</p>

        <div className="field">
          <label htmlFor="seed-input" className="sr-only">
            Artists you sound like
          </label>
          <div className="chipbox" onClick={() => inputRef.current?.focus()}>
            {form.seeds.map((s, i) => (
              <span className="chip" key={s.name}>
                {s.image ? <img className="avatar" src={s.image} alt="" /> : <span className="avatar">{initials(s.name)}</span>}
                {s.name}
                <button type="button" aria-label={`Remove ${s.name}`} onClick={() => remove(i)}>
                  ×
                </button>
              </span>
            ))}
            {form.seeds.length < 5 && (
              <input
                id="seed-input"
                ref={inputRef}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={onKey}
                onFocus={() => results.length && setOpen(true)}
                onBlur={() => setTimeout(() => setOpen(false), 150)}
                placeholder={form.seeds.length ? 'Add another (up to 5)' : 'Artists you sound like, e.g. Bon Iver'}
                autoComplete="off"
                role="combobox"
                aria-expanded={open && results.length > 0}
                aria-controls={listId}
                aria-autocomplete="list"
              />
            )}
          </div>
          {open && results.length > 0 && (
            <div className="suggest" role="listbox" id={listId}>
              {results.map((r, i) => (
                <button type="button" role="option" aria-selected={i === active} key={r.id || r.name} onMouseDown={(e) => e.preventDefault()} onClick={() => add(r)}>
                  {r.image ? <img src={r.image} alt="" /> : <span className="ph" />}
                  <span>{r.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <button type="button" className="details-toggle" aria-expanded={showDetails} onClick={() => setShowDetails((v) => !v)}>
          {showDetails ? 'Hide tour details' : 'Tour details (optional)'}
          <span aria-hidden="true">{showDetails ? '−' : '+'}</span>
        </button>
        {showDetails && (
          <div className="details">
            <label>
              Your act’s name
              <input value={form.actName} maxLength={40} onChange={(e) => setForm({ ...form, actName: e.target.value })} placeholder="For the tour poster" />
            </label>
            <label>
              Home city
              <input value={form.home} maxLength={60} onChange={(e) => setForm({ ...form, home: e.target.value })} placeholder="e.g. Portland, OR" />
            </label>
            <label>
              Number of shows
              <select value={form.stops} onChange={(e) => setForm({ ...form, stops: Number(e.target.value) })}>
                {[3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                  <option key={n} value={n}>
                    {n} shows
                  </option>
                ))}
              </select>
            </label>
            <label>
              First show
              <input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
            </label>
            <label className="wide">
              Your sound in a few words
              <input value={form.sound} maxLength={140} onChange={(e) => setForm({ ...form, sound: e.target.value })} placeholder="e.g. moody indie-folk with big harmonies" />
            </label>
          </div>
        )}

        <div className="cta-row">
          <span className="ticket-wrap">
            <button type="button" className="ticket" disabled={busy || (!form.seeds.length && !text.trim())} onClick={() => (text.trim() ? (add({ name: text }), setTimeout(onStart, 0)) : onStart())}>
              <span className="main">Find my people</span>
              <span className="stub" aria-hidden="true">
                Admit 1
              </span>
            </button>
          </span>
          <button type="button" className="linkish" onClick={onDemo} disabled={busy}>
            Try a demo artist
          </button>
          {health && !liveReady && <p className="note">Live search needs a Qloo key on the server. The demo works without one.</p>}
        </div>
        {error && (
          <div className="error-box" role="alert">
            {error}
          </div>
        )}
      </div>
    </main>
  );
}
