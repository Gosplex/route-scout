#!/usr/bin/env node
// Route Scout — Day 1 Qloo API check
// Node 18+ required (uses built-in fetch). No packages to install.
//
// Run (Mac/Linux):
//   QLOO_API_KEY=your_key node qloo-day1-test.mjs
// Run (Windows PowerShell):
//   $env:QLOO_API_KEY="your_key"; node qloo-day1-test.mjs
//
// Optional: pass your own seed artists:
//   node qloo-day1-test.mjs "Bon Iver" "Fleet Foxes" "Phoebe Bridgers"
// Optional env: CITY_A (default Boise), CITY_B (default Chicago)

import { writeFileSync } from 'node:fs';

const KEY = process.env.QLOO_API_KEY;
const BASE = (process.env.QLOO_BASE_URL || 'https://hackathon.api.qloo.com').replace(/\/$/, '');
if (!KEY) {
  console.error('Missing QLOO_API_KEY. See the run instructions at the top of this file.');
  process.exit(1);
}

const SEEDS = process.argv.slice(2).length ? process.argv.slice(2) : ['Bon Iver', 'Fleet Foxes', 'Phoebe Bridgers'];
const CITY_A = process.env.CITY_A || 'Boise';
const CITY_B = process.env.CITY_B || 'Chicago';
const US_POLYGON = 'POLYGON((-125 24, -66 24, -66 50, -125 50, -125 24))';

const summary = [];
const raw = {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function snippet(body) {
  if (body == null) return '';
  const s = typeof body === 'string' ? body : JSON.stringify(body);
  return ' | ' + s.slice(0, 160);
}

function record(test, ok, detail) {
  summary.push({ test, result: ok ? 'PASS' : 'FAIL', detail });
  console.log(`${ok ? '✅' : '❌'} ${test}: ${detail}`);
}

async function call(name, path, params = {}) {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    url.searchParams.set(k, Array.isArray(v) ? v.join(',') : String(v));
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  const t0 = Date.now();
  let status = 0, body = null, err = null;
  try {
    const res = await fetch(url, { headers: { 'X-Api-Key': KEY, Accept: 'application/json' }, signal: ctrl.signal });
    status = res.status;
    const text = await res.text();
    try { body = JSON.parse(text); } catch { body = text.slice(0, 500); }
  } catch (e) {
    err = e.name === 'AbortError' ? 'timeout' : e.message;
  }
  clearTimeout(timer);
  const ms = Date.now() - t0;
  raw[name] = { url: url.toString(), status, ms, error: err, body };
  await sleep(350); // be gentle with rate limits
  return { status, body, ms, err };
}

const entitiesOf = (b) => (Array.isArray(b?.results) ? b.results : b?.results?.entities || []);
const tagsOf = (b) => b?.results?.tags || [];
const heatOf = (b) => b?.results?.heatmap || [];
const fail = (r) => r.err || `HTTP ${r.status}${snippet(r.body)}`;
const names = (list, n = 8) => list.slice(0, n).map((e) => e.name || e.tag_id || '?').join(', ');

console.log(`\nRoute Scout — Qloo Day 1 test\nServer: ${BASE}\nSeeds: ${SEEDS.join(', ')}\nCities: ${CITY_A}, ${CITY_B}\n`);

// 1. Resolve seed artists
const ids = [];
for (const s of SEEDS) {
  const r = await call(`search:${s}`, '/search', { query: s, types: 'urn:entity:artist', take: 3 });
  const top = entitiesOf(r.body)[0];
  if (r.status === 200 && top) {
    ids.push(top.entity_id);
    record(`1. Search "${s}"`, true, `${top.name} | id ${top.entity_id} | image: ${top.properties?.image?.url ? 'yes' : 'no'} | ${r.ms}ms`);
  } else {
    record(`1. Search "${s}"`, false, fail(r));
  }
}

if (!ids.length) {
  console.log('\nNo artists resolved, so the remaining tests were skipped.');
} else {
  // 2. Heatmap variants (the Hidden City core)
  const heatVariants = [
    ['2a. Heatmap: US polygon, city boundary', { 'filter.location': US_POLYGON, 'output.heatmap.boundary': 'urn:entity:locality' }],
    ['2b. Heatmap: "United States" query, city boundary', { 'filter.location.query': 'United States', 'output.heatmap.boundary': 'urn:entity:locality' }],
    [`2c. Heatmap: ${CITY_B} + 800km radius, city boundary`, { 'filter.location.query': CITY_B, 'filter.location.radius': 800000, 'output.heatmap.boundary': 'urn:entity:locality' }],
    ['2d. Heatmap: US polygon, default geohash grid', { 'filter.location': US_POLYGON }],
  ];
  for (const [label, extra] of heatVariants) {
    const r = await call(label, '/v2/insights', { 'filter.type': 'urn:heatmap', 'signal.interests.entities': ids, take: 50, ...extra });
    const heat = heatOf(r.body);
    if (r.status === 200 && heat.length) {
      const top = heat.slice(0, 8).map((h) => {
        const n = h.name || h.location?.name || h.entity?.name || h.location?.geohash || '?';
        const ar = h.query?.affinity_rank ?? h.query?.affinity;
        return `${n}(${typeof ar === 'number' ? ar.toFixed(3) : ar})`;
      }).join(', ');
      record(label, true, `${heat.length} points | top: ${top} | first item keys: ${Object.keys(heat[0]).join('/')} | ${r.ms}ms`);
    } else {
      record(label, false, fail(r));
    }
  }

  // 3. Artist insights with city signal (local support acts)
  const artistParams = { 'filter.type': 'urn:entity:artist', 'signal.interests.entities': ids, 'filter.exclude.entities': ids, 'filter.popularity.max': 0.6, take: 10 };
  const base = await call('3. Artists (no city)', '/v2/insights', artistParams);
  const a = await call(`3. Artists in ${CITY_A}`, '/v2/insights', { ...artistParams, 'signal.location.query': CITY_A });
  const b = await call(`3. Artists in ${CITY_B}`, '/v2/insights', { ...artistParams, 'signal.location.query': CITY_B });
  const la = entitiesOf(a.body), lb = entitiesOf(b.body), l0 = entitiesOf(base.body);
  if (base.status === 200) record('3a. Similar small artists (no city)', l0.length > 0, `${l0.length} results: ${names(l0)}`);
  else record('3a. Similar small artists (no city)', false, fail(base));
  if (a.status === 200 && b.status === 200) {
    const setA = new Set(la.map((e) => e.entity_id));
    const overlap = lb.filter((e) => setA.has(e.entity_id)).length;
    record('3b. City signal changes artist results', la.length > 0 && overlap < Math.max(la.length, lb.length),
      `${CITY_A}: ${names(la, 5)} || ${CITY_B}: ${names(lb, 5)} || overlap ${overlap}/${Math.max(la.length, lb.length)}`);
  } else {
    record('3b. City signal changes artist results', false, `${CITY_A}: ${fail(a)} || ${CITY_B}: ${fail(b)}`);
  }

  // 4. Venue tags + places in a city
  let venueTag = null;
  for (const q of ['music venue', 'live music', 'concert']) {
    const r = await call(`4. Tags "${q}"`, '/v2/tags', { 'filter.query': q, take: 10 });
    const tags = tagsOf(r.body);
    if (r.status === 200 && tags.length) {
      record(`4a. Tag search "${q}"`, true, tags.slice(0, 6).map((t) => t.id || t.tag_id).join(', '));
      venueTag = venueTag || (tags.find((t) => (t.id || t.tag_id || '').includes('place')) || tags[0]);
    } else {
      record(`4a. Tag search "${q}"`, false, fail(r));
    }
  }
  const placeParams = { 'filter.type': 'urn:entity:place', 'signal.interests.entities': ids, 'filter.location.query': CITY_A, take: 10 };
  const p1 = await call(`4. Places in ${CITY_A}`, '/v2/insights', placeParams);
  const pl1 = entitiesOf(p1.body);
  record(`4b. Taste-matched places in ${CITY_A}`, p1.status === 200 && pl1.length > 0, p1.status === 200 ? `${pl1.length}: ${names(pl1)}` : fail(p1));
  if (venueTag) {
    const tagId = venueTag.id || venueTag.tag_id;
    const p2 = await call(`4. Venues in ${CITY_A}`, '/v2/insights', { ...placeParams, 'filter.tags': tagId });
    const pl2 = entitiesOf(p2.body);
    record(`4c. Venues in ${CITY_A} (tag ${tagId})`, p2.status === 200 && pl2.length > 0, p2.status === 200 ? `${pl2.length}: ${names(pl2)}` : fail(p2));
  }

  // 5. Demographics
  const d = await call('5. Demographics', '/v2/insights', { 'filter.type': 'urn:demographics', 'signal.interests.entities': ids });
  const demo = d.body?.results?.demographics;
  record('5. Demographics (age/gender)', d.status === 200 && !!demo?.length, d.status === 200 ? JSON.stringify(demo?.[0]?.query || {}).slice(0, 200) : fail(d));

  // 6. Taste tags for a city (crowd vibe)
  const t = await call('6. Taste tags', '/v2/insights', { 'filter.type': 'urn:tag', 'signal.interests.entities': ids, 'signal.location.query': CITY_A, take: 15 });
  const tt = tagsOf(t.body).length ? tagsOf(t.body) : entitiesOf(t.body);
  record(`6. Crowd taste tags in ${CITY_A}`, t.status === 200 && tt.length > 0, t.status === 200 ? names(tt, 10) : fail(t));

  // 7. Cross-domain brands with explainability
  const br = await call('7. Brands + explainability', '/v2/insights', { 'filter.type': 'urn:entity:brand', 'signal.interests.entities': ids, 'signal.location.query': CITY_A, 'feature.explainability': true, take: 5 });
  const bl = entitiesOf(br.body);
  const hasExplain = !!(br.body?.query?.explainability || bl.some((e) => e.query?.explainability));
  record(`7. Brands in ${CITY_A} + explainability`, br.status === 200 && bl.length > 0, br.status === 200 ? `${names(bl, 5)} | explainability: ${hasExplain ? 'yes' : 'no'}` : fail(br));

  // 8. Trending
  const end = new Date();
  const start = new Date(Date.now() - 180 * 864e5);
  const fmt = (x) => x.toISOString().slice(0, 10);
  const tr = await call('8. Trending', '/v2/trending', { 'signal.interests.entities': ids[0], 'filter.type': 'urn:entity:artist', 'filter.start_date': fmt(start), 'filter.end_date': fmt(end), take: 5 });
  const trend = tr.body?.results?.trending;
  record('8. Trending (rising badge)', tr.status === 200 && Array.isArray(trend), tr.status === 200 ? `${trend?.length ?? 0} weeks | latest: ${JSON.stringify(trend?.[0] || {}).slice(0, 160)}` : fail(tr));

  // 9. Compare (why two acts pair well)
  if (ids.length >= 2) {
    let c = await call('9. Compare (analysis)', '/v2/analysis/compare', { 'a.signal.interests.entities': ids[0], 'b.signal.interests.entities': ids[1], take: 5 });
    let route = '/v2/analysis/compare';
    if (c.status !== 200) {
      c = await call('9. Compare (insights)', '/v2/insights/compare', { 'a.signal.interests.entities': ids[0], 'b.signal.interests.entities': ids[1], take: 5 });
      route = '/v2/insights/compare';
    }
    record('9. Compare two artists', c.status === 200, c.status === 200 ? `${route} works${snippet(c.body)}` : fail(c));
  }
}

// Save + print paste-back summary
writeFileSync('qloo-day1-results.json', JSON.stringify({ base: BASE, seeds: SEEDS, cities: [CITY_A, CITY_B], summary, raw }, null, 2));
const passed = summary.filter((s) => s.result === 'PASS').length;
console.log('\n================ COPY FROM HERE ================');
console.log(`Qloo Day 1: ${passed}/${summary.length} passed`);
for (const s of summary) console.log(`${s.result} | ${s.test} | ${s.detail}`);
console.log('================= COPY TO HERE =================');
console.log('\nFull raw responses saved to qloo-day1-results.json (no API key inside).');
