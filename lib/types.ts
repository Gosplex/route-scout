export type Artist = {
  id: string;
  name: string;
  image?: string;
  popularity?: number;
};

/** One Qloo heatmap cell, normalised. */
export type HeatPoint = {
  lat: number;
  lng: number;
  /** Qloo affinity_rank (0..1) */
  affinity: number;
  /** Qloo popularity (0..1) */
  popularity: number;
  /** 0..1 rank of this cell among all returned cells (computed by us) */
  rank?: number;
};

export type City = {
  id: string;
  name: string;
  state: string;
  pop: number;
  lat: number;
  lng: number;
};

export type CityScore = City & {
  /** 0..1 percentile among cities with Qloo signal */
  taste: number;
  /** mean affinity_rank of the city's strongest cells */
  tasteRaw: number;
  /** top-x percent label, e.g. 2 means "top 2%" */
  topPercent: number;
  cells: number;
  /** 0..1, higher = less crowded with similar ticketed shows. undefined = no Ticketmaster data */
  room?: number;
  genreShows?: number;
  musicShows?: number;
  similarBooked?: { artist: string; date: string; venue?: string }[];
  /** 0..1, how well it fits the route (filled during planning) */
  fit?: number;
  /** 0..100 */
  score?: number;
  /** listed by the plain AI */
  obvious?: boolean;
};

export type Stop = CityScore & {
  order: number;
  date: string;
  /** distance from previous stop (or home) */
  legKm: number;
  legHours: number;
};

export type Baseline = {
  source: 'ai' | 'fallback';
  model?: string;
  names: string[];
  cities: City[];
};

export type Audience = {
  age: Record<string, number>;
  gender: Record<string, number>;
};

export type TourPlan = {
  id: string;
  actName: string;
  artists: Artist[];
  sound: string;
  genre: string | null;
  home: City | null;
  stops: Stop[];
  candidates: CityScore[];
  heat: HeatPoint[];
  baseline: Baseline;
  hiddenCityId: string | null;
  headline: string;
  summary: string;
  audience: Audience | null;
  sources: { qloo: boolean; ticketmaster: boolean; ai: boolean };
  agent: { mode: 'ai' | 'autopilot'; model?: string; steps: number };
  demo?: boolean;
  createdAt: string;
};

export type TraceEvent = {
  id: string;
  label: string;
  detail?: string;
  status: 'running' | 'done' | 'warn' | 'error';
  tool?: string;
  ms?: number;
};

export type Place = {
  id?: string;
  name: string;
  image?: string;
  address?: string;
  note?: string;
};

export type Venue = {
  name: string;
  shows?: number;
  url?: string;
  source: 'ticketmaster' | 'qloo' | 'both';
};

export type SupportAct = {
  id: string;
  name: string;
  image?: string;
  rising?: boolean;
  why?: string;
};

export type Brand = {
  id?: string;
  name: string;
  image?: string;
  why?: string;
};

export type CityDetail = {
  cityId: string;
  city: string;
  state: string;
  crowdLine: string;
  tags: string[];
  brands: Brand[];
  hangouts: Place[];
  venues: Venue[];
  supportActs: SupportAct[];
  sources: { qloo: boolean; ticketmaster: boolean; ai: boolean };
  demo?: boolean;
};

export type AgentInput = {
  artists: string[];
  sound?: string;
  actName?: string;
  home?: string;
  stops?: number;
  startDate?: string;
};

export type StreamMessage =
  | { type: 'trace'; event: TraceEvent }
  | { type: 'artists'; artists: Artist[] }
  | { type: 'heat'; heat: HeatPoint[] }
  | { type: 'result'; plan: TourPlan }
  | { type: 'error'; message: string };
