'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import DeckGL from '@deck.gl/react';
import { FlyToInterpolator, MapView, WebMercatorViewport } from '@deck.gl/core';
import { ArcLayer, ColumnLayer, GeoJsonLayer, PathLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import { feature } from 'topojson-client';
import statesTopo from 'us-atlas/states-10m.json';
import { haversineKm } from '@/lib/geo';
import type { HeatPoint, Stop, TourPlan } from '@/lib/types';

const SKIP = new Set(['02', '15', '60', '66', '69', '72', '78']);
const states = feature(statesTopo as any, (statesTopo as any).objects.states) as any;
states.features = states.features.filter((f: any) => !SKIP.has(String(f.id)));

export type MapMode = 'obvious' | 'lights' | 'tour';
export type Focus = { lat: number; lng: number; zoom: number; pitch?: number; bearing?: number; key: string } | null;

type RGBA = [number, number, number, number];
const CYAN: RGBA = [0, 229, 255, 255];
const MAGENTA: RGBA = [255, 46, 136, 255];
const AMBER: RGBA = [255, 181, 71, 255];
const PAPER: RGBA = [247, 243, 234, 255];

const mix = (a: RGBA, b: RGBA, t: number, alpha: number): RGBA => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t),
  alpha,
];

function pillarColor(p: HeatPoint, nearHidden: boolean): RGBA {
  const k = p.rank ?? 0.5;
  if (nearHidden && k > 0.85) return [255, 196, 96, 255];
  if (k > 0.985) return [...AMBER.slice(0, 3), 235] as RGBA;
  if (k > 0.95) return [...MAGENTA.slice(0, 3), 215] as RGBA;
  if (k > 0.8) return mix(CYAN, MAGENTA, (k - 0.8) / 0.15, 150);
  return [0, 229, 255, Math.round(30 + k * 50)];
}

const pillarHeight = (p: HeatPoint, scale = 1) => 1500 + Math.pow(p.rank ?? 0, 7) * 260000 * scale;

/** Draw on top of the pillars so route, stops and labels stay readable. */
const ON_TOP = { depthWriteEnabled: false, depthCompare: 'always' } as any;

export default function TourMap({
  plan,
  stops,
  mode,
  showObvious,
  selectedId,
  onSelect,
  focus,
  panelSide,
}: {
  plan: TourPlan;
  stops: Stop[];
  mode: MapMode;
  showObvious: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  focus: Focus;
  panelSide: 'right' | 'bottom' | 'none';
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 1200, h: 800 });
  const [vs, setVs] = useState<any>(() => ({ longitude: -97, latitude: 38.6, zoom: 3.4, pitch: 42, bearing: -8, transitionDuration: 0 }));
  const [tick, setTick] = useState(0);
  const reduce = useRef(false);

  useEffect(() => {
    reduce.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      setSize({ w, h });
      setVs((v: any) => (v.__fitted ? v : { ...v, zoom: w < 700 ? 2.55 : w < 1100 ? 3.0 : 3.45 }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Fly to a requested focus (reveal)
  useEffect(() => {
    if (!focus) return;
    setVs((v: any) => ({
      ...v,
      longitude: focus.lng,
      latitude: focus.lat,
      zoom: focus.zoom,
      pitch: focus.pitch ?? 55,
      bearing: focus.bearing ?? -12,
      transitionDuration: reduce.current ? 0 : 2200,
      transitionInterpolator: new FlyToInterpolator({ speed: 1.4 }),
      __fitted: true,
    }));
  }, [focus?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fit the whole tour when entering tour mode
  const fitKey = mode === 'tour' ? stops.map((s) => s.id).join('|') + panelSide + size.w : '';
  useEffect(() => {
    if (mode !== 'tour' || !stops.length || size.w < 50) return;
    const pts = [...stops, ...(plan.home ? [plan.home] : [])];
    const lngs = pts.map((p) => p.lng);
    const lats = pts.map((p) => p.lat);
    const pad =
      panelSide === 'right'
        ? { top: 110, bottom: 70, left: 70, right: 430 }
        : panelSide === 'bottom'
          ? { top: 100, bottom: Math.round(size.h * 0.5), left: 30, right: 30 }
          : { top: 100, bottom: 70, left: 70, right: 70 };
    try {
      const vp = new WebMercatorViewport({ width: size.w, height: size.h });
      const { longitude, latitude, zoom } = vp.fitBounds(
        [
          [Math.min(...lngs) - 0.8, Math.min(...lats) - 0.6],
          [Math.max(...lngs) + 0.8, Math.max(...lats) + 0.6],
        ],
        { padding: pad },
      );
      setVs((v: any) => ({
        ...v,
        longitude,
        latitude,
        zoom: Math.min(zoom, 6.2) - 0.15,
        pitch: 40,
        bearing: -6,
        transitionDuration: reduce.current ? 0 : 1600,
        transitionInterpolator: new FlyToInterpolator({ speed: 1.6 }),
        __fitted: true,
      }));
    } catch {
      /* viewport too small */
    }
  }, [fitKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pulse travelling along the route
  useEffect(() => {
    if (mode !== 'tour' || reduce.current) return;
    let raf = 0;
    let last = 0;
    const loop = (t: number) => {
      if (t - last > 33) {
        setTick(t);
        last = t;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [mode]);

  const hidden = stops.find((s) => s.id === plan.hiddenCityId) || plan.candidates.find((c) => c.id === plan.hiddenCityId) || null;
  const heat = plan.heat;
  const nearHidden = useMemo(() => {
    const set = new Set<number>();
    if (!hidden) return set;
    heat.forEach((p, i) => {
      if (Math.abs(p.lat - hidden.lat) < 1 && Math.abs(p.lng - hidden.lng) < 1.3 && haversineKm(p, hidden) < 75) set.add(i);
    });
    return set;
  }, [heat, hidden?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const route = useMemo(() => {
    const pts = [...(plan.home ? [plan.home] : []), ...stops];
    return pts.map((p) => [p.lng, p.lat] as [number, number]);
  }, [stops, plan.home]);

  const legs = useMemo(() => route.slice(1).map((to, i) => ({ from: route[i], to, i })), [route]);

  const pulse = useMemo(() => {
    if (mode !== 'tour' || legs.length === 0) return [];
    const total = legs.length;
    const pos = ((tick / 1000) * 0.45) % total;
    const leg = legs[Math.floor(pos)];
    const f = pos - Math.floor(pos);
    return [{ p: [leg.from[0] + (leg.to[0] - leg.from[0]) * f, leg.from[1] + (leg.to[1] - leg.from[1]) * f] }];
  }, [tick, legs, mode]);

  const lit = mode !== 'obvious';
  const showBase = mode === 'obvious' || showObvious;
  const obvious = plan.baseline.cities;
  const stopVisible = mode === 'tour';

  const layers = [
    new GeoJsonLayer({
      id: 'states',
      data: states,
      filled: true,
      stroked: true,
      getFillColor: [16, 17, 44, 255],
      getLineColor: [0, 229, 255, 46],
      lineWidthMinPixels: 0.7,
    }),
    heat.length > 0 &&
      new ColumnLayer<HeatPoint>({
        id: 'pillars',
        data: heat,
        diskResolution: 6,
        radius: 8500,
        extruded: true,
        pickable: false,
        opacity: mode === 'tour' ? 0.5 : 0.95,
        getPosition: (p) => [p.lng, p.lat],
        getElevation: (p) => (lit ? pillarHeight(p, mode === 'tour' ? 0.45 : 1) : 0),
        getFillColor: (p, { index }) => pillarColor(p, nearHidden.has(index)),
        material: { ambient: 0.55, diffuse: 0.65, shininess: 40, specularColor: [255, 255, 255] },
        transitions: { getElevation: { duration: reduce.current ? 0 : 1900, easing: (t: number) => 1 - Math.pow(1 - t, 3) } },
        updateTriggers: { getElevation: [lit, mode], getFillColor: [hidden?.id, nearHidden.size] },
      }),
    showBase &&
      new ScatterplotLayer({
        id: 'obvious', parameters: ON_TOP,
        data: obvious,
        getPosition: (c: any) => [c.lng, c.lat],
        getRadius: 7,
        radiusUnits: 'pixels',
        stroked: true,
        getFillColor: [150, 150, 170, mode === 'obvious' ? 230 : 120],
        getLineColor: [230, 230, 240, 160],
        lineWidthMinPixels: 1.5,
      }),
    showBase &&
      new TextLayer({
        id: 'obvious-labels', parameters: ON_TOP,
        data: obvious,
        getPosition: (c: any) => [c.lng, c.lat],
        getText: (c: any) => c.name,
        getSize: 14,
        getColor: [200, 200, 215, mode === 'obvious' ? 255 : 170],
        getPixelOffset: [0, -18],
        fontFamily: 'Barlow, Arial, sans-serif',
        fontWeight: 600,
        characterSet: 'auto',
        background: true,
        getBackgroundColor: [3, 4, 11, 180],
        backgroundPadding: [5, 2],
      }),
    stopVisible &&
      new PathLayer({
        id: 'ground-route',
        data: [{ path: route }],
        getPath: (d: any) => d.path,
        getColor: [255, 46, 136, 70],
        getWidth: 2,
        widthUnits: 'pixels',
      }),
    stopVisible &&
      new ArcLayer({
        id: 'arcs', parameters: ON_TOP,
        data: legs,
        getSourcePosition: (d: any) => d.from,
        getTargetPosition: (d: any) => d.to,
        getSourceColor: MAGENTA,
        getTargetColor: CYAN,
        getWidth: 3.5,
        getHeight: 0.45,
        widthMinPixels: 2,
      }),
    stopVisible &&
      new ScatterplotLayer({
        id: 'pulse', parameters: ON_TOP,
        data: pulse,
        getPosition: (d: any) => d.p,
        getRadius: 7,
        radiusUnits: 'pixels',
        getFillColor: [255, 255, 255, 255],
        stroked: true,
        getLineColor: [255, 46, 136, 200],
        lineWidthMinPixels: 4,
      }),
    stopVisible &&
      plan.home &&
      new ScatterplotLayer({
        id: 'home', parameters: ON_TOP,
        data: [plan.home],
        getPosition: (c: any) => [c.lng, c.lat],
        getRadius: 6,
        radiusUnits: 'pixels',
        getFillColor: [247, 243, 234, 255],
      }),
    (stopVisible || (mode === 'lights' && hidden)) &&
      new ScatterplotLayer<any>({
        id: 'stops', parameters: ON_TOP,
        data: stopVisible ? stops : [hidden],
        pickable: true,
        getPosition: (s) => [s.lng, s.lat],
        getRadius: (s) => (s.id === plan.hiddenCityId ? 13 : s.id === selectedId ? 12 : 9),
        radiusUnits: 'pixels',
        stroked: true,
        getFillColor: [3, 4, 11, 235],
        getLineColor: (s) => (s.id === plan.hiddenCityId ? AMBER : s.id === selectedId ? PAPER : CYAN),
        lineWidthMinPixels: 3,
        onClick: (info: any) => info.object && onSelect(info.object.id),
        updateTriggers: { getRadius: [selectedId], getLineColor: [selectedId] },
      }),
    stopVisible &&
      new TextLayer<Stop>({
        id: 'stop-labels', parameters: ON_TOP,
        data: stops,
        pickable: true,
        onClick: (info: any) => info.object && onSelect(info.object.id),
        getPosition: (s) => [s.lng, s.lat],
        getText: (s) => `${s.order}  ${s.name}`,
        getSize: 15,
        getColor: (s) => (s.id === plan.hiddenCityId ? AMBER : PAPER),
        getPixelOffset: [0, -24],
        fontFamily: 'Barlow, Arial, sans-serif',
        fontWeight: 700,
        characterSet: 'auto',
        background: true,
        getBackgroundColor: [3, 4, 11, 215],
        backgroundPadding: [7, 3],
        updateTriggers: { getColor: [plan.hiddenCityId] },
      }),
  ].filter(Boolean);

  return (
    <div className="deck-holder" ref={wrap}>
      <DeckGL
        views={new MapView({ repeat: false })}
        viewState={vs}
        onViewStateChange={({ viewState }: any) => setVs({ ...viewState, __fitted: true })}
        controller={{ dragRotate: true, touchRotate: true, doubleClickZoom: true }}
        layers={layers as any}
        getCursor={({ isHovering, isDragging }: any) => (isDragging ? 'grabbing' : isHovering ? 'pointer' : 'grab')}
        getTooltip={({ object, layer }: any) =>
          object && layer?.id === 'stops'
            ? { text: `${object.name}, ${object.state}${object.score ? ` · score ${object.score}` : ''}`, style: { background: '#0d0e21', color: '#f7f3ea', fontFamily: 'Barlow, sans-serif', borderRadius: '8px', border: '1px solid rgba(0,229,255,.4)' } }
            : null
        }
      />
    </div>
  );
}
