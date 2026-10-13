/**
 * Generates the bundled SAMPLE demo (no API keys needed). Values are illustrative, not live data.
 * Replace with real recorded data any time with:  npm run snapshot
 */
import { writeFileSync } from 'node:fs';
import { TourSession } from '../lib/agent';
import { CITIES, aggregateHeatToCities, downsampleHeat, rankHeat } from '../lib/geo';
import type { CityDetail, HeatPoint, StreamMessage } from '../lib/types';

let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

// Illustrative taste field for "moody indie-folk"
const HOT: Record<string, number> = {
  Portland: 0.96, Seattle: 0.95, Boise: 0.993, Spokane: 0.95, Eugene: 0.95, Missoula: 0.975, Bellingham: 0.94,
  Bend: 0.95, 'Salt Lake City': 0.955, Denver: 0.94, Boulder: 0.95, 'Fort Collins': 0.95, Minneapolis: 0.94,
  Madison: 0.955, 'Ann Arbor': 0.94, Asheville: 0.965, Athens: 0.93, Burlington: 0.94, Chicago: 0.92,
  'New York City': 0.9, Austin: 0.9, Nashville: 0.9, Durham: 0.93, Richmond: 0.92, Pittsburgh: 0.91,
  Milwaukee: 0.91, 'Iowa City': 0.94, Lawrence: 0.93, Columbia: 0.9, Duluth: 0.95, Olympia: 0.95, 'Grand Rapids': 0.92,
};
const heat: HeatPoint[] = [];
for (const c of CITIES) {
  const base = HOT[c.name] ?? 0.55 + rnd() * 0.3;
  const cells = 2 + Math.floor(rnd() * 5);
  for (let i = 0; i < cells; i++) {
    heat.push({
      lat: c.lat + (rnd() - 0.5) * 0.45,
      lng: c.lng + (rnd() - 0.5) * 0.55,
      affinity: Math.min(0.999, base + (rnd() - 0.5) * 0.04),
      popularity: Math.min(1, Math.max(0.05, Math.log10(c.pop) / 7 + (rnd() - 0.5) * 0.2)),
    });
  }
}
for (let i = 0; i < 2600; i++) {
  heat.push({ lat: 26 + rnd() * 22, lng: -123 + rnd() * 52, affinity: 0.2 + rnd() * 0.5, popularity: rnd() * 0.4 });
}

const msgs: StreamMessage[] = [];
const s = new TourSession(
  { artists: ['Bon Iver', 'Fleet Foxes', 'Phoebe Bridgers'], sound: 'moody indie-folk with big harmonies', actName: 'The Low Pines', stops: 6, home: 'Portland, OR' },
  (m) => msgs.push(m),
);
s.artists = [
  { id: 'E51DB8F2-7A93-4746-A283-E55B5216FDE1', name: 'Bon Iver' },
  { id: '17CA60C4-D34B-4D9C-B6BC-E1CD59BDFAA5', name: 'Fleet Foxes' },
  { id: 'AFBC71A7-9439-4AB0-AB68-D14B11AAF836', name: 'Phoebe Bridgers' },
];
s.heat = rankHeat(heat);
s.cities = aggregateHeatToCities(s.heat);
s.tmGenre = 'Folk';
for (const c of s.pool) {
  const perCap = c.name === 'Boise' ? 4 : c.name === 'Missoula' ? 3 : Math.round((c.pop / 100000) * (2 + rnd() * 3));
  c.genreShows = Math.max(2, perCap);
  c.musicShows = c.genreShows * (6 + Math.floor(rnd() * 6));
  s.roomChecked.add(c.id);
}
s.computeRoom();
const chi = s.cities.find((c) => c.name === 'Chicago');
if (chi) { chi.genreShows = 38; chi.musicShows = 610; }
await s.ask_plain_ai();
await s.plan_tour({}, true);
s.validateNarrative();
const plan = await s.buildPlan();
plan.audience = {
  age: { '24_and_younger': 0.29, '25_to_29': 0.33, '30_to_34': 0.2, '35_to_44': -0.63, '45_to_54': -0.44, '55_and_older': -0.53 },
  gender: { male: -0.47, female: 0.47 },
};
plan.heat = downsampleHeat(s.heat, 4500);
plan.demo = true;
plan.sources = { qloo: false, ticketmaster: false, ai: false };
plan.agent = { mode: 'autopilot', steps: 0 };
plan.id = 'demo';

const VENUES: Record<string, string[]> = {
  Boise: ['Neurolux', 'Knitting Factory Concert House', 'The Olympic'],
  Portland: ['Doug Fir Lounge', 'Mississippi Studios', 'Revolution Hall'],
  Seattle: ['Neumos', 'The Crocodile', 'Tractor Tavern'],
  Spokane: ['The Bartlett', 'Knitting Factory Spokane'],
  Missoula: ['The Wilma', 'Top Hat Lounge'],
  Eugene: ['WOW Hall', 'McDonald Theatre'],
  'Salt Lake City': ['Kilby Court', 'The State Room', 'The Depot'],
  Denver: ['Bluebird Theater', 'Larimer Lounge', 'Gothic Theatre'],
  Minneapolis: ['First Avenue', '7th St Entry', 'Turf Club'],
  Madison: ['High Noon Saloon', 'The Sylvee'],
  Asheville: ['The Orange Peel', 'The Grey Eagle'],
};
const ACTS = ['Whitmer Thomas', 'Lauren Ruth Ward', 'Shelby Earl', 'Katie Pruitt', 'Prism Bitch', 'Elizabeth Moen', 'Quinn Christopherson', 'Caleb Groh', 'Bird Courage', 'Hailaker', 'Johanna Samuels', 'Jack Symes'];
const BRANDS = ['Patagonia', 'REI', 'The North Face', 'Huckberry', 'Fjällräven', 'Filson', 'Pendleton', 'Blundstone', 'Danner', 'Arc\'teryx'];
const TAGS = ['Indie folk', 'Alt-country', 'Americana', 'Folk rock', 'Coffee shops', 'Record stores', 'Craft beer', 'Trail running'];
const HANG = ['a corner record store', 'a third-wave coffee bar', 'a taproom with a back patio', 'an art-house cinema'];

const details: Record<string, CityDetail> = {};
plan.stops.forEach((st, i) => {
  const rot = <T,>(arr: T[], k: number, n: number) => Array.from({ length: n }, (_, j) => arr[(k + j) % arr.length]);
  const isBoise = st.name === 'Boise';
  const tags = isBoise ? ['Indie folk', 'Alt-country', 'Americana', 'Folk rock', 'Coffee shops'] : rot(TAGS, i * 2, 5);
  const brands = (isBoise ? ['Patagonia', 'REI', 'The North Face', 'Huckberry', 'Fjällräven'] : rot(BRANDS, i * 3, 5)).map((name, k) => ({
    name,
    why: `Strongest link: fans of ${plan.artists[k % 3].name}`,
  }));
  const venues = (VENUES[st.name] || ['Main room venue', 'Small listening room']).map((name, k) => ({ name, shows: 9 - k * 3, source: 'ticketmaster' as const }));
  const acts = (isBoise ? ACTS.slice(0, 5) : rot(ACTS, i * 2 + 5, 4)).map((name, k) => ({ id: `sample-${i}-${k}`, name, rising: k === 0 || k === 2 }));
  details[st.id] = {
    cityId: st.id,
    city: st.name,
    state: st.state,
    crowdLine: `Your ${st.name} crowd leans ${tags[0].toLowerCase()} and ${tags[1].toLowerCase()}, shops ${brands[0].name} and ${brands[1].name}, and hangs out at ${HANG[i % HANG.length]}.`,
    tags,
    brands,
    hangouts: HANG.map((name) => ({ name })),
    venues,
    supportActs: acts,
    sources: { qloo: false, ticketmaster: false, ai: false },
    demo: true,
  };
});

writeFileSync('data/demo/plan.json', JSON.stringify(plan));
writeFileSync('data/demo/details.json', JSON.stringify(details));
console.log('Sample demo written:', plan.stops.map((x) => `${x.name} (${x.score})`).join(', '), '| hidden:', plan.hiddenCityId, plan.headline, '|', plan.summary);
