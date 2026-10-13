import {
  CITIES,
  addDays,
  aggregateHeatToCities,
  defaultStartDate,
  downsampleHeat,
  driveHours,
  findCity,
  haversineKm,
  orderRoute,
  rankHeat,
  selectStops,
} from './geo';
import { chat, hasOpenRouter, modelName, parseJson, type ChatMessage, type ToolSpec } from './openrouter';
import { demographics, genreTags, hasQloo, heatmap, resolveArtist } from './qloo';
import { bookedNear, hasTicketmaster, showDensity, toTicketmasterGenre, upcomingDates } from './ticketmaster';
import type {
  AgentInput,
  Artist,
  Audience,
  Baseline,
  City,
  CityScore,
  HeatPoint,
  Stop,
  StreamMessage,
  TourPlan,
} from './types';

type Emit = (m: StreamMessage) => void;

const POOL_SIZE = 12;
const FALLBACK_OBVIOUS = ['New York, NY', 'Los Angeles, CA', 'Chicago, IL', 'Nashville, TN', 'Austin, TX', 'Seattle, WA', 'Atlanta, GA', 'Denver, CO'];

const label = (c: City) => `${c.name}, ${c.state}`;

export class TourSession {
  private seq = 0;
  artists: Artist[] = [];
  heat: HeatPoint[] = [];
  cities: CityScore[] = [];
  tmGenre: string | null = null;
  genreNames: string[] = [];
  roomChecked = new Set<string>();
  bookedChecked = false;
  private booked: Awaited<ReturnType<typeof upcomingDates>> = [];
  baseline: Baseline | null = null;
  stops: Stop[] = [];
  hiddenId: string | null = null;
  headline = '';
  summary = '';
  aiHeadline = '';
  home: City | null;
  nStops: number;
  startDate: string;
  actName: string;
  sound: string;
  audience: Promise<Audience | null> = Promise.resolve(null);
  agentMode: 'ai' | 'autopilot' = 'autopilot';
  model?: string;
  steps = 0;

  constructor(public input: AgentInput, private emit: Emit) {
    this.home = input.home ? findCity(input.home) : null;
    this.nStops = Math.min(10, Math.max(3, Number(input.stops) || 6));
    this.startDate = /^\d{4}-\d{2}-\d{2}$/.test(input.startDate || '') ? (input.startDate as string) : defaultStartDate();
    this.actName = (input.actName || '').trim().slice(0, 40) || 'Your act';
    this.sound = (input.sound || '').trim().slice(0, 140);
  }

  private trace(label: string, tool?: string) {
    const id = `t${++this.seq}`;
    const t0 = Date.now();
    this.emit({ type: 'trace', event: { id, label, tool, status: 'running' } });
    return {
      done: (detail?: string, status: 'done' | 'warn' | 'error' = 'done') =>
        this.emit({ type: 'trace', event: { id, label, tool, detail, status, ms: Date.now() - t0 } }),
    };
  }

  note(label: string, detail?: string, status: 'done' | 'warn' = 'done') {
    this.trace(label).done(detail, status);
  }

  get pool(): CityScore[] {
    return this.cities.slice(0, POOL_SIZE);
  }

  // ---------------------------------------------------------------- tools

  async resolve_artists(args: { names?: string[] }) {
    const names = (args.names?.length ? args.names : this.input.artists).map((s) => String(s).trim()).filter(Boolean).slice(0, 5);
    const t = this.trace(`Matching ${names.join(', ')} in Qloo`, 'resolve_artists');
    const found = await Promise.all(names.map((n) => resolveArtist(n).catch(() => null)));
    const missing = names.filter((_, i) => !found[i]);
    const seen = new Set<string>();
    this.artists = found.filter((a): a is Artist => !!a && !seen.has(a.id) && !!seen.add(a.id));
    if (!this.artists.length) {
      t.done('No matches found', 'error');
      throw new Error(`Qloo couldn't find ${names.join(', ')}. Try artists with a bigger following.`);
    }
    this.emit({ type: 'artists', artists: this.artists });
    t.done(`Found ${this.artists.map((a) => a.name).join(', ')}${missing.length ? ` (no match for ${missing.join(', ')})` : ''}`, missing.length ? 'warn' : 'done');
    return { resolved: this.artists.map((a) => ({ id: a.id, name: a.name })), missing };
  }

  async scan_taste_map() {
    if (!this.artists.length) await this.resolve_artists({});
    const ids = this.artists.map((a) => a.id);
    const t = this.trace('Scanning the US taste map', 'scan_taste_map');
    this.audience = demographics(ids).catch(() => null);
    const [heat, genres] = await Promise.all([heatmap(ids), genreTags(ids).catch(() => [] as string[])]);
    this.heat = rankHeat(heat);
    this.cities = aggregateHeatToCities(this.heat);
    this.genreNames = genres;
    this.tmGenre = toTicketmasterGenre([this.sound, ...genres]);
    this.emit({ type: 'heat', heat: downsampleHeat(this.heat, 2500) });
    t.done(`${heat.length.toLocaleString()} map cells scored across ${this.cities.length} cities`);
    return {
      cells: heat.length,
      cities_with_signal: this.cities.length,
      genre_for_ticketmaster: this.tmGenre,
      qloo_genres: genres.slice(0, 5),
      top_candidates: this.cities.slice(0, 18).map((c) => ({ city_id: c.id, city: label(c), top_percent: c.topPercent, population: c.pop })),
    };
  }

  async check_room_to_grow(args: { city_ids?: string[] }) {
    if (!this.cities.length) await this.scan_taste_map();
    if (!hasTicketmaster()) {
      this.note('Show-competition check skipped', 'Add a Ticketmaster key to include it', 'warn');
      return { available: false, note: 'No Ticketmaster key; score on taste and route only.' };
    }
    const wanted = (args.city_ids?.length ? args.city_ids : this.pool.map((c) => c.id))
      .map((id) => this.cities.find((c) => c.id === String(id)))
      .filter((c): c is CityScore => !!c && !this.roomChecked.has(c.id))
      .slice(0, 14);
    if (!wanted.length) return { checked: 0, note: 'Already checked' };
    const t = this.trace(`Counting upcoming ${this.tmGenre || 'music'} shows in ${wanted.length} cities`, 'check_room_to_grow');
    let fails = 0;
    for (const c of wanted) {
      if (fails >= 2) break; // Ticketmaster is down or limiting us: stop and score on taste
      try {
        const d = await showDensity(c, this.tmGenre);
        c.musicShows = d.musicShows;
        c.genreShows = d.genreShows ?? d.musicShows;
        this.roomChecked.add(c.id);
        fails = 0;
      } catch {
        fails++;
      }
    }
    this.computeRoom();
    const rows = wanted.map((c) => ({ city: label(c), city_id: c.id, genre_shows_6mo: c.genreShows, music_shows_6mo: c.musicShows, room: c.room }));
    const quiet = [...wanted].filter((c) => c.room !== undefined).sort((a, b) => (b.room ?? 0) - (a.room ?? 0))[0];
    t.done(quiet ? `Least crowded: ${label(quiet)} (${quiet.genreShows} similar shows in 6 months)` : 'No show data returned', quiet ? 'done' : 'warn');
    return { checked: rows };
  }

  /** Room = how uncrowded a city is with similar ticketed shows, per 100k people, relative to the other candidates. */
  computeRoom() {
    const withData = this.cities.filter((c) => this.roomChecked.has(c.id));
    if (!withData.length) return;
    const density = (c: CityScore) => (c.genreShows ?? 0) / Math.max(0.5, c.pop / 100_000);
    const sorted = [...withData].sort((a, b) => density(a) - density(b));
    const n = Math.max(1, sorted.length - 1);
    sorted.forEach((c, i) => (c.room = Math.round((1 - i / n) * 100) / 100));
  }

  async check_similar_artist_tours() {
    if (!hasTicketmaster()) return { available: false };
    if (this.bookedChecked) return { note: 'Already checked' };
    const t = this.trace('Checking where similar artists already have dates', 'check_similar_artist_tours');
    const all = await Promise.all(this.artists.slice(0, 3).map((a) => upcomingDates(a.name).catch(() => [])));
    this.booked = all.flat();
    this.bookedChecked = true;
    for (const c of this.pool) {
      const near = bookedNear(this.booked, c);
      if (near.length) c.similarBooked = near.slice(0, 3);
    }
    const hit = this.pool.filter((c) => c.similarBooked?.length);
    t.done(this.booked.length ? `${this.booked.length} upcoming US dates found; ${hit.length} overlap your top cities` : 'No upcoming US dates for these artists');
    return { dates_found: this.booked.length, overlaps: hit.map((c) => ({ city: label(c), dates: c.similarBooked })) };
  }

  async ask_plain_ai() {
    if (this.baseline) return { cities: this.baseline.names };
    const t = this.trace('Asking a plain AI (no data) where to tour', 'ask_plain_ai');
    let names: string[] = [];
    let source: Baseline['source'] = 'fallback';
    let model: string | undefined;
    if (hasOpenRouter()) {
      try {
        const r = await chat(
          [
            { role: 'system', content: 'You are a general-purpose assistant with no data tools. Answer from general knowledge only.' },
            {
              role: 'user',
              content: `I'm an independent act that sounds like ${this.artists.map((a) => a.name).join(', ')}${this.sound ? ` (${this.sound})` : ''}. Which ${this.nStops} US cities should I tour? Reply only with JSON: {"cities":["City, ST", ...]}`,
            },
          ],
          { temperature: 0.4, maxTokens: 200, json: true },
        );
        names = (parseJson<{ cities: string[] }>(r.content)?.cities || []).filter((x) => typeof x === 'string').slice(0, 10);
        if (names.length) {
          source = 'ai';
          model = r.model;
        }
      } catch {
        /* use fallback */
      }
    }
    if (!names.length) names = FALLBACK_OBVIOUS.slice(0, Math.max(6, this.nStops));
    const cities = names.map((n) => findCity(n)).filter((c): c is City => !!c);
    this.baseline = { source, model, names, cities };
    const ids = new Set(cities.map((c) => c.id));
    this.cities.forEach((c) => (c.obvious = ids.has(c.id) || cities.some((b) => haversineKm(b, c) < 60)));
    t.done(`${source === 'ai' ? 'It' : 'The usual list'} suggests ${names.slice(0, 6).join(', ')}`);
    return { cities: names };
  }

  async plan_tour(args: { stops?: number }, silent = false) {
    if (!this.cities.length) await this.scan_taste_map();
    if (args?.stops) this.nStops = Math.min(10, Math.max(3, Number(args.stops)));
    const t = silent ? { done: (_d?: string) => undefined } : this.trace(`Planning a ${this.nStops}-stop route`, 'plan_tour');
    const pool = this.pool.length ? this.pool : this.cities.slice(0, POOL_SIZE);
    const raws = pool.map((c) => c.tasteRaw);
    const min = Math.min(...raws);
    const max = Math.max(...raws);
    const useRoom = pool.some((c) => c.room !== undefined);
    for (const c of pool) {
      const tasteLocal = max > min ? 0.5 + 0.5 * ((c.tasteRaw - min) / (max - min)) : 1;
      const room = c.room ?? 0.5;
      const raw = useRoom ? 0.6 * tasteLocal + 0.4 * room : tasteLocal;
      c.score = Math.max(1, Math.min(100, Math.round(raw * 100 - (c.similarBooked?.length ? 4 : 0))));
    }
    const chosen = selectStops(pool, this.nStops, this.home);
    const ordered = orderRoute(chosen, this.home);
    let prev: { lat: number; lng: number } | null = this.home;
    let date = this.startDate;
    this.stops = ordered.map((c, i) => {
      const legKm = prev ? Math.round(haversineKm(prev, c)) : 0;
      const legHours = driveHours(legKm);
      if (i > 0) date = addDays(date, legHours > 9 ? 2 : 1);
      prev = c;
      return { ...c, order: i + 1, date, legKm, legHours };
    });
    const fresh = [...this.stops].filter((s) => !s.obvious).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    const hidden = fresh[0] || [...pool].filter((c) => !c.obvious).sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0] || this.stops[0];
    this.hiddenId = hidden?.id || null;
    const totalKm = this.stops.reduce((s, x) => s + x.legKm, 0);
    t.done(`${this.stops.map((s) => s.name).join(' → ')} · ${totalKm.toLocaleString()} km`);
    return {
      stops: this.stops.map((s) => ({ city: label(s), date: s.date, score: s.score, top_percent: s.topPercent, genre_shows_6mo: s.genreShows, plain_ai_listed: !!s.obvious })),
      hidden_city: hidden ? label(hidden) : null,
      hidden_city_facts: hidden ? { top_percent: hidden.topPercent, genre_shows_6mo: hidden.genreShows, similar_artist_dates: hidden.similarBooked || [] } : null,
      plain_ai_cities: this.baseline?.names || [],
    };
  }

  async finish(args: { headline?: string; summary?: string }) {
    this.aiHeadline = String(args?.headline || '').trim().replace(/\s+/g, ' ');
    this.validateNarrative();
    return { ok: true, headline_used: this.headline, summary_used: this.summary };
  }

  // ---------------------------------------------------------------- helpers

  /**
   * Guardrail: the summary is always assembled from tool results, so every number is real.
   * The AI headline is kept only if it names the final hidden city and contains no numbers.
   */
  validateNarrative() {
    const hidden = this.hiddenCity();
    const h = this.aiHeadline;
    const ok = h && h.length <= 60 && !/\d/.test(h) && (!hidden || h.toLowerCase().includes(hidden.name.toLowerCase()));
    this.headline = ok ? h : this.templateHeadline();
    this.summary = this.templateSummary();
  }

  hiddenCity() {
    return this.stops.find((s) => s.id === this.hiddenId) || this.cities.find((c) => c.id === this.hiddenId) || null;
  }

  templateHeadline() {
    const h = this.hiddenCity();
    return h ? `Your people are in ${h.name}` : 'Your tour is ready';
  }

  templateSummary() {
    const h = this.hiddenCity();
    const names = this.artists.map((a) => a.name).join(', ');
    if (!h) return `A ${this.stops.length}-stop route built from where fans of ${names} cluster.`;
    const g = this.tmGenre ? this.tmGenre.toLowerCase() : 'similar';
    const shows = h.genreShows !== undefined ? ` ${h.genreShows === 0 ? 'No' : `Only ${h.genreShows}`} ticketed ${g} ${h.genreShows === 1 ? 'show is' : 'shows are'} booked there in the next six months.` : '';
    const plain = this.baseline && !h.obvious ? ' The plain AI never mentioned it.' : '';
    return `${h.name}, ${h.state} sits in the top ${h.topPercent}% of US cities for fans of ${names}.${shows}${plain}`;
  }

  async buildPlan(): Promise<TourPlan> {
    const audience = await this.audience;
    return {
      id: Math.random().toString(36).slice(2, 10),
      actName: this.actName,
      artists: this.artists,
      sound: this.sound,
      genre: this.tmGenre,
      home: this.home,
      stops: this.stops,
      candidates: this.cities.slice(0, 40),
      heat: downsampleHeat(this.heat, 4500),
      baseline: this.baseline || { source: 'fallback', names: [], cities: [] },
      hiddenCityId: this.hiddenId,
      headline: this.headline || this.templateHeadline(),
      summary: this.summary || this.templateSummary(),
      audience,
      sources: { qloo: true, ticketmaster: hasTicketmaster() && this.roomChecked.size > 0, ai: this.agentMode === 'ai' || this.baseline?.source === 'ai' },
      agent: { mode: this.agentMode, model: this.model, steps: this.steps },
      createdAt: new Date().toISOString(),
    };
  }
}

// -------------------------------------------------------------------- tool specs for the model

const TOOLS: ToolSpec[] = [
  {
    type: 'function',
    function: {
      name: 'resolve_artists',
      description: 'Match the artists the act sounds like to Qloo entities. Call first.',
      parameters: { type: 'object', properties: { names: { type: 'array', items: { type: 'string' } } }, required: ['names'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'scan_taste_map',
      description: 'Pull the Qloo taste heatmap for the resolved artists across the US and rank cities by fan affinity. Returns candidate city ids.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'check_room_to_grow',
      description: 'Ticketmaster: count upcoming ticketed shows in the act\'s genre for candidate cities (fewer per capita = more room). Pass 10-14 candidate city ids.',
      parameters: { type: 'object', properties: { city_ids: { type: 'array', items: { type: 'string' } } }, required: ['city_ids'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'check_similar_artist_tours',
      description: 'Ticketmaster: find where the similar artists already have upcoming US dates near candidate cities.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ask_plain_ai',
      description: 'Ask a model with no data tools where to tour, to compare against.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'plan_tour',
      description: 'Score candidates (taste + room to grow), pick stops that fit a drivable route, order them and assign dates. Returns the hidden city.',
      parameters: { type: 'object', properties: { stops: { type: 'integer', minimum: 3, maximum: 10 } } },
    },
  },
  {
    type: 'function',
    function: {
      name: 'finish',
      description: 'End the run with a punchy headline (max 8 words, no numbers) that names the hidden city returned by plan_tour. The summary is assembled from tool data automatically.',
      parameters: {
        type: 'object',
        properties: { headline: { type: 'string' }, summary: { type: 'string' } },
        required: ['headline', 'summary'],
      },
    },
  },
];

const SYSTEM = (s: TourSession) => `You are Route Scout, a tour-planning agent for independent artists.
Your tools are backed by real data: Qloo (cultural taste by place), Ticketmaster (upcoming ticketed shows) and a plain-AI baseline.
Goal: plan a ${s.nStops}-stop US tour for "${s.actName}", an act that sounds like ${s.input.artists.join(', ')}${s.sound ? ` (${s.sound})` : ''}.
Work in this order, choosing arguments yourself:
1. resolve_artists with the names.
2. scan_taste_map.
3. check_room_to_grow with the 10-14 strongest candidate city_ids from the scan.
4. check_similar_artist_tours.
5. ask_plain_ai.
6. plan_tour.
7. finish.
Rules: use only facts returned by tools. Never invent cities, venues, dates or numbers. Keep messages short. If a tool reports it is unavailable, continue without it.`;

export async function runAgent(input: AgentInput, emit: Emit): Promise<TourPlan> {
  if (!hasQloo()) throw new Error('QLOO_API_KEY is not set on the server.');
  const s = new TourSession(input, emit);
  const run = async (name: string, args: any) => {
    switch (name) {
      case 'resolve_artists':
        return s.resolve_artists(args);
      case 'scan_taste_map':
        return s.scan_taste_map();
      case 'check_room_to_grow':
        return s.check_room_to_grow(args);
      case 'check_similar_artist_tours':
        return s.check_similar_artist_tours();
      case 'ask_plain_ai':
        return s.ask_plain_ai();
      case 'plan_tour':
        return s.plan_tour(args);
      case 'finish':
        return s.finish(args);
      default:
        return { error: `Unknown tool ${name}` };
    }
  };

  if (hasOpenRouter()) {
    s.agentMode = 'ai';
    s.model = modelName();
    const messages: ChatMessage[] = [
      { role: 'system', content: SYSTEM(s) },
      { role: 'user', content: JSON.stringify({ artists: input.artists, sound: s.sound, stops: s.nStops, home: s.home ? label(s.home) : null, start: s.startDate }) },
    ];
    let finished = false;
    try {
      for (let i = 0; i < 10 && !finished; i++) {
        const r = await chat(messages, { tools: TOOLS, temperature: 0.2, maxTokens: 700 });
        s.model = r.model;
        s.steps++;
        if (!r.toolCalls.length) break;
        messages.push({ role: 'assistant', content: r.content ?? null, tool_calls: r.toolCalls });
        for (const call of r.toolCalls) {
          let args: any = {};
          try {
            args = JSON.parse(call.function.arguments || '{}');
          } catch {
            args = {};
          }
          let result: any;
          try {
            result = await run(call.function.name, args);
          } catch (e: any) {
            if (call.function.name === 'resolve_artists') throw e;
            result = { error: String(e?.message || e) };
          }
          if (call.function.name === 'finish') finished = true;
          messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result).slice(0, 6000) });
        }
      }
    } catch (e: any) {
      if (String(e?.message || '').includes("couldn't find")) throw e;
      s.agentMode = s.steps > 1 ? 'ai' : 'autopilot';
      s.note('AI agent hit a problem, finishing on autopilot', String(e?.message || e).slice(0, 140), 'warn');
    }
  } else {
    s.note('Running on autopilot', 'Add an OpenRouter key to let the AI agent drive', 'warn');
  }

  // Coverage check: guarantee every brief has taste, room, baseline and route.
  if (!s.artists.length) await s.resolve_artists({ names: input.artists });
  if (!s.cities.length) await s.scan_taste_map();
  if (hasTicketmaster()) {
    await s.check_room_to_grow({ city_ids: s.pool.map((c) => c.id) });
    await s.check_similar_artist_tours();
  }
  if (!s.baseline) await s.ask_plain_ai();
  // Final deterministic pass so scores, the hidden city and the narrative all use the complete data.
  await s.plan_tour({}, s.stops.length > 0);
  s.validateNarrative();
  return s.buildPlan();
}

export { CITIES };
