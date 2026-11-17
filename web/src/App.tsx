import { lazy, Suspense, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { GlobeFocus, GlobeHit, GlobePoint } from "@/components/ui/3d-globe";

const Globe3D = lazy(() => import("@/components/ui/3d-globe").then((m) => ({ default: m.Globe3D })));
import { GroupExplorer } from "@/components/group-explorer";
import { CountryList, FilterBar, Kpis, Section, SBG_COLOR, TopGroups, UG_COLOR } from "@/components/stats";
import { AnalyticsBento } from "@/components/analytics-bento";
import {
  byCountry, byMonth, byWeekday, centerOf, CONTINENT_CENTER, CONTINENTS, loadEvents, loadGroups, matches, places, totals,
  type Continent, type Dataset, type EventRow, type Filters, type Group, type Place,
} from "@/lib/data";
import { LANGS, useI18n } from "@/lib/i18n";
import { Flag } from "@/components/flag";
import { Emblem, GitHubIcon, REPO_URL } from "@/components/logo";
import { cn } from "@/lib/utils";

const GLOBE_CONFIG = {
  radius: 2,
  distance: 3.1,
  minDistance: 1.3,
  maxDistance: 3.8,
  initialRotation: { lat: 12, lng: -45 },
  autoRotateSpeed: 0.18,
  ambientIntensity: 1.7,
  sunIntensity: 1.1,
  atmosphereColor: "#9cc9ff",
  atmosphereIntensity: 0.55,
  atmosphereBlur: 1.6,
  pointColor: "#e3af35",
  pointOutline: "#0b0b0d",
  pointSize: 0.017,
};

// ── Estado en la URL (para compartir un filtro) ─────────────────────────────

function readUrl(): { filters: Filters; q: string; g: string | null } {
  const p = new URLSearchParams(location.search);
  const type = p.get("type");
  const region = p.get("region");
  return {
    filters: {
      type: type === "SBG" || type === "UG" ? type : "ALL",
      continent: CONTINENTS.includes(region as Continent) ? (region as Continent) : "ALL",
      country: p.get("country")?.toLowerCase() || "ALL",
    },
    q: p.get("q") ?? "",
    g: p.get("group"),
  };
}

function writeUrl(f: Filters, q: string, g: string | null) {
  const p = new URLSearchParams();
  if (f.type !== "ALL") p.set("type", f.type);
  if (f.continent !== "ALL") p.set("region", f.continent);
  if (f.country !== "ALL") p.set("country", f.country);
  if (q) p.set("q", q);
  if (g) p.set("group", g);
  const s = p.toString();
  history.replaceState(null, "", s ? `?${s}` : location.pathname);
}

/** Distancia de cámara para que el país quepa: según qué tan dispersos están sus grupos. */
function distanceFor(gs: Group[], c: { lat: number; lng: number }) {
  const rad = Math.PI / 180;
  const angles = gs.map((g) => {
    const cos = Math.sin(c.lat * rad) * Math.sin(g.lat * rad) + Math.cos(c.lat * rad) * Math.cos(g.lat * rad) * Math.cos((g.lng - c.lng) * rad);
    return Math.acos(Math.min(1, Math.max(-1, cos))) / rad;
  }).sort((a, b) => a - b);
  const spread = angles[Math.floor(angles.length * 0.9)] ?? 0;
  return Math.min(2.5, Math.max(1.45, 1.4 + spread / 22));
}

/** Cuenta animada hacia el valor; respeta prefers-reduced-motion. */
function CountUp({ value }: { value: number }) {
  const { num } = useI18n();
  const [shown, setShown] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) { setShown(value); from.current = value; return; }
    const start = performance.now(), a = from.current, dur = 1200;
    let raf = 0;
    const tick = (now: number) => {
      const k = Math.min(1, (now - start) / dur);
      setShown(Math.round(a + (value - a) * (1 - Math.pow(1 - k, 4))));
      if (k < 1) raf = requestAnimationFrame(tick);
      else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); from.current = value; };
  }, [value]);
  return <span className="tabular-nums">{num(shown)}</span>;
}

function LangSwitch() {
  const { lang, setLang } = useI18n();
  return (
    <div className="flex rounded-full border border-line bg-surface p-0.5 text-xs" role="group" aria-label="Language">
      {LANGS.map((l) => (
        <button
          key={l}
          onClick={() => setLang(l)}
          aria-pressed={lang === l}
          className={cn("rounded-full px-2.5 py-1 font-medium uppercase transition-colors", lang === l ? "bg-ink-2 text-fg" : "text-muted-fg hover:text-fg")}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

type HoverStore = ReturnType<typeof createHoverStore>;

function createHoverStore() {
  let value: GlobeHit | null = null;
  const subs = new Set<() => void>();
  return {
    get: () => value,
    set: (v: GlobeHit | null) => { value = v; subs.forEach((f) => f()); },
    sub: (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; },
  };
}

/** Tarjeta flotante del globo: sigue al cursor sin re-renderizar el resto de la página. */
function HoverLayer({ store, placeById, filters }: { store: HoverStore; placeById: Map<string, Place>; filters: Filters }) {
  const hover = useSyncExternalStore(store.sub, store.get);
  const [pos, setPos] = useState({ x: 0, y: 0 });

  useEffect(() => {
    if (!hover) return;
    let raf = 0;
    const onMove = (e: PointerEvent) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setPos({ x: e.clientX, y: e.clientY }));
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => { cancelAnimationFrame(raf); window.removeEventListener("pointermove", onMove); };
  }, [hover]);

  // Burbuja agrupada: une los grupos visibles de todas sus ciudades
  const data = useMemo(() => {
    if (!hover) return null;
    const ps = hover.ids.map((id) => placeById.get(id)).filter((p): p is Place => !!p);
    const gs = ps.flatMap((p) => p.groups).filter((g) => matches(g, filters));
    if (!gs.length) return null;
    const top = [...ps].sort((a, b) => b.meetups - a.meetups)[0];
    return { place: { ...top, groups: gs }, cities: ps.length };
  }, [hover, placeById, filters]);

  return data ? <PlaceCard place={data.place} cities={data.cities} pos={pos} /> : null;
}

function PlaceCard({ place, cities, pos }: { place: Place; cities: number; pos: { x: number; y: number } }) {
  const { t, num, country } = useI18n();
  const sorted = [...place.groups].sort((a, b) => b.meetups - a.meetups);
  const shown = sorted.slice(0, 4);
  const countries = new Set(place.groups.map((g) => g.country)).size;
  const approx = cities === 1 && place.groups.every((g) => g.geo === "country");
  const left = Math.max(8, Math.min(pos.x + 18, window.innerWidth - 316));
  const top = Math.min(pos.y + 18, window.innerHeight - 90 - shown.length * 52);
  return (
    <div className="pointer-events-none fixed z-50 w-[300px] rounded-2xl border border-line bg-raised p-4 shadow-[0_18px_40px_-12px_rgb(0_0_0/0.7)]" style={{ left, top }}>
      <p className="font-heading text-lg leading-tight font-semibold text-fg">
        {cities > 1 ? (countries === 1 ? country(place.country) : t.citiesN(cities)) : approx ? country(place.country) : place.city}
      </p>
      <p className="mt-0.5 text-sm text-muted-fg">
        {countries === 1 && <Flag code={place.country} className="mr-1.5" />}
        {cities > 1 ? t.groupsInCities(place.groups.length, cities) : approx ? t.approx : country(place.country)}
      </p>
      <ul className="mt-3 space-y-2.5">
        {shown.map((g) => (
          <li key={g.id} className="flex gap-2.5">
            <span className="mt-1.5 size-2 shrink-0 rounded-full" style={{ background: g.type === "SBG" ? SBG_COLOR : UG_COLOR }} />
            <div className="min-w-0">
              <p className="truncate text-sm text-fg">{g.name}</p>
              <p className="text-xs text-muted-fg">{g.meetups ? `${t.meetupsN(num(g.meetups))}, ${num(g.reach)} ${t.reach}` : t.noActivity}</p>
            </div>
          </li>
        ))}
      </ul>
      {sorted.length > shown.length && <p className="mt-2.5 text-xs text-muted-fg">{t.more(sorted.length - shown.length)}</p>}
      {cities > 1 && <p className="mt-2.5 text-xs text-amber">{t.clickToZoom}</p>}
    </div>
  );
}

export default function App() {
  const { t, date, country } = useI18n();
  const initial = useMemo(readUrl, []);
  const [data, setData] = useState<Dataset | null>(null);
  const [events, setEvents] = useState<EventRow[] | null>(null);
  const [error, setError] = useState(false);
  const [filters, setFilters] = useState<Filters>(initial.filters);
  const [query, setQuery] = useState(initial.q);
  const [openId, setOpenId] = useState<string | null>(initial.g);
  // El hover del globo vive fuera del estado de App: moverse sobre el globo no re-renderiza la página
  const hoverStore = useMemo(createHoverStore, []);

  useEffect(() => {
    loadGroups().then(setData).catch(() => setError(true));
    loadEvents().then(setEvents).catch(() => setEvents([]));
  }, []);

  useEffect(() => writeUrl(filters, query, openId), [filters, query, openId]);

  const groups = useMemo(() => data?.groups ?? [], [data]);
  const groupById = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups]);
  const filtered = useMemo(() => groups.filter((g) => matches(g, filters)), [groups, filters]);
  const sum = useMemo(() => totals(filtered), [filtered]);
  const countryStats = useMemo(() => byCountry(filtered), [filtered]);
  const months = useMemo(
    () => byMonth(events ?? [], groupById, (g) => matches(g, filters)),
    [events, groupById, filters],
  );
  const days = useMemo(
    () => byWeekday(events ?? [], groupById, (g) => matches(g, filters)),
    [events, groupById, filters],
  );
  const eventsByGroup = useMemo(() => {
    if (!events) return null;
    const m = new Map<string, EventRow[]>();
    for (const e of events) {
      const list = m.get(e[0]);
      if (list) list.push(e); else m.set(e[0], [e]);
    }
    return m;
  }, [events]);

  // Opciones del selector de país: respetan tipo y región, no el país elegido
  const countryOptions = useMemo(() => {
    const c = new Map<string, number>();
    for (const g of groups) if (matches(g, { ...filters, country: "ALL" })) c.set(g.country, (c.get(g.country) ?? 0) + 1);
    return [...c.entries()].map(([code, n]) => ({ code, n }));
  }, [groups, filters]);

  // ── Globo ──
  const allPlaces = useMemo(() => places(groups), [groups]);
  const placeById = useMemo(() => new Map(allPlaces.map((p) => [p.id, p])), [allPlaces]);
  const points = useMemo<GlobePoint[]>(() => allPlaces.map((p) => {
    const visible = p.groups.filter((g) => matches(g, filters));
    return {
      id: p.id, lat: p.lat, lng: p.lng,
      weight: visible.reduce((s, g) => s + g.meetups, 0) + visible.length,
      color: visible.filter((g) => g.type === "SBG").length * 2 >= visible.length ? SBG_COLOR : UG_COLOR,
      dimmed: visible.length === 0,
    };
  }), [allPlaces, filters]);

  const openGroup = openId ? groupById.get(openId) ?? null : null;

  const { focus, selected, focusLabel } = useMemo(() => {
    if (openGroup) {
      return {
        focus: { lat: openGroup.lat, lng: openGroup.lng, distance: 1.5 } as GlobeFocus,
        selected: [{ lat: openGroup.lat, lng: openGroup.lng }],
        focusLabel: <><Flag code={openGroup.country} className="mr-2" />{openGroup.name}</>,
      };
    }
    if (filters.country !== "ALL") {
      const c = centerOf(filtered);
      const ps = places(filtered).sort((a, b) => b.meetups - a.meetups);
      return {
        focus: c ? ({ ...c, distance: distanceFor(filtered, c) } as GlobeFocus) : null,
        selected: ps.slice(0, 5).map((p) => ({ lat: p.lat, lng: p.lng })),
        focusLabel: <><Flag code={filters.country} className="mr-2" />{country(filters.country)}</>,
      };
    }
    if (filters.continent !== "ALL") {
      return {
        focus: { ...CONTINENT_CENTER[filters.continent], distance: 2.25 } as GlobeFocus,
        selected: [],
        focusLabel: <>{t.continents[filters.continent]}</>,
      };
    }
    return { focus: null, selected: [], focusLabel: null };
  }, [openGroup, filters, filtered, country, t]);

  const explorerRef = useRef<HTMLDivElement>(null);

  const changeFilters = (f: Filters) => {
    setFilters(f);
    if (openGroup && !matches(openGroup, f)) setOpenId(null);
  };

  const openFromAnywhere = (g: Group) => {
    setOpenId(g.id);
    if (!matches(g, filters)) setFilters({ type: "ALL", continent: "ALL", country: "ALL" });
    setQuery("");
  };

  const onPointClick = (hit: GlobeHit) => {
    const place = placeById.get(hit.ids[0]);
    if (!place) return;
    const visible = place.groups.filter((g) => matches(g, filters));
    setFilters({ ...filters, continent: visible[0]?.continent ?? filters.continent, country: place.country });
    if (visible.length === 1) {
      setOpenId(visible[0].id);
      setQuery("");
    } else {
      setOpenId(null);
      setQuery(visible.every((g) => g.geo === "country") ? "" : place.city);
    }
    explorerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const year = data?.year ?? 2026;

  return (
    <div className="relative min-h-svh overflow-x-clip bg-ink text-fg">
      <header className="relative z-20 mx-auto flex max-w-[1440px] items-center justify-between px-4 py-5 sm:px-8">
        <a href="/" className="flex items-center gap-2.5 font-heading text-lg font-semibold tracking-tight">
          <Emblem size={30} />
          <span>{t.title} <span className="text-muted-fg">{year}</span></span>
        </a>
        <div className="flex items-center gap-2">
          <a
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-medium text-fg/85 transition-colors hover:border-fg/40 hover:text-fg"
          >
            <GitHubIcon size={14} />
            <span className="hidden sm:inline">{t.openSource}</span>
          </a>
          <LangSwitch />
        </div>
      </header>

      <div className="mx-auto grid max-w-[1440px] grid-cols-[minmax(0,1fr)] px-4 sm:px-8 lg:grid-cols-[minmax(0,540px)_minmax(0,1fr)] lg:gap-x-10">
        {/* Hero */}
        <div className="relative z-10 pt-6 pb-8 lg:col-start-1 lg:row-start-1 lg:pt-[min(10vh,96px)]">
          {error ? (
            <p className="text-lg text-muted-fg">{t.loadError}</p>
          ) : (
            <>
              <h1 className="font-heading text-[clamp(2.1rem,3.7vw,3.5rem)] leading-[1.03] font-medium tracking-[-0.03em] text-balance text-fg/75">
                {t.heroLead(year)}{" "}
                <strong className="font-bold text-fg"><CountUp value={sum.active} /></strong> {t.heroGroups(sum.active)}{" "}
                {t.heroRan} <strong className="font-bold text-fg"><CountUp value={sum.meetups} /></strong> {t.heroMeetups}{" "}
                {t.heroAcross} <strong className="font-bold text-fg"><CountUp value={sum.countries} /></strong> {t.heroCountries(sum.countries)}.
              </h1>
              <p className="mt-6 max-w-[48ch] text-base leading-relaxed text-muted-fg sm:text-lg">{t.heroSub}</p>
            </>
          )}
        </div>

        {/* Globo: fijo a la derecha en escritorio */}
        <div className="relative -mx-4 sm:-mx-8 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:mx-0">
          <div className="relative h-[min(115vw,600px)] bg-[radial-gradient(closest-side,#2a2a33_0%,#1b1b21_55%,transparent_100%)] lg:sticky lg:top-0 lg:-mt-[76px] lg:h-[min(100vh,980px)] lg:w-[calc(100%+max(2rem,(100vw-1440px)/2+2rem))]">
            {data ? (
              <Suspense fallback={<p className="grid h-full place-items-center text-sm text-muted-fg">{t.loading}</p>}>
              <Globe3D
                className="h-full"
                config={GLOBE_CONFIG}
                points={points}
                focus={focus}
                selected={selected}
                onPointHover={hoverStore.set}
                onPointClick={onPointClick}
                showControls
                controlLabels={{ zoomIn: t.zoomIn, zoomOut: t.zoomOut, reset: t.zoomReset }}
              />
              </Suspense>
            ) : (
              !error && <p className="grid h-full place-items-center text-sm text-muted-fg">{t.loading}</p>
            )}
            <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 hidden w-16 bg-gradient-to-r from-ink to-transparent lg:block" />
            {focusLabel && (
              <p className="pointer-events-none absolute top-4 left-1/2 max-w-[80%] -translate-x-1/2 truncate rounded-full border border-line-strong bg-raised px-4 py-1.5 text-sm font-medium text-fg shadow-[0_8px_24px_-10px_rgb(0_0_0/0.7)] lg:top-24">
                {focusLabel}
              </p>
            )}
            <div className="pointer-events-none absolute bottom-4 left-4 max-w-[calc(100%-5.5rem)] rounded-xl border border-line-strong bg-raised/95 px-3.5 py-2.5 shadow-[0_8px_24px_-10px_rgb(0_0_0/0.7)] lg:left-20 lg:bottom-6">
              <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg">
                <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full ring-1 ring-black/60" style={{ background: SBG_COLOR }} />{t.sbg}</span>
                <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full ring-1 ring-black/60" style={{ background: UG_COLOR }} />{t.ug}</span>
              </p>
              <p className="mt-1 text-[11px] text-muted-fg">{t.globeHint}</p>
            </div>
          </div>
        </div>

        {/* Filtros + KPIs: van junto al globo */}
        <div className="relative z-10 space-y-10 pt-4 pb-20 lg:col-start-1 lg:row-start-2">
          {data && (
            <>
              <FilterBar filters={filters} setFilters={changeFilters} countryOptions={countryOptions} />
              <Kpis sum={sum} CountUp={CountUp} />
            </>
          )}
        </div>
      </div>

      {/* Estadísticas a todo el ancho: aquí el globo ya no acompaña */}
      <main className="relative z-10 mx-auto max-w-[1440px] space-y-14 px-4 pb-16 sm:px-8">
        {data && (
          <>
            <Section title={t.monthTitle} sub={t.monthSub}>
              <AnalyticsBento
                months={months}
                days={days}
                countries={countryStats}
                totalMeetups={sum.meetups}
                totalReach={sum.reach}
                CountUp={CountUp}
                onSelectCountry={(code) => {
                  changeFilters({ ...filters, country: code, continent: groups.find((g) => g.country === code)?.continent ?? filters.continent });
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
              />
            </Section>

            <div className="grid grid-cols-[minmax(0,1fr)] gap-x-14 gap-y-14 [contain-intrinsic-size:auto_900px] [content-visibility:auto] lg:grid-cols-2">
              {filters.country === "ALL" && (
                <Section title={t.countriesTitle} sub={t.countriesSub}>
                  <CountryList
                    stats={countryStats}
                    selected={filters.country}
                    onSelect={(code) => changeFilters({
                      ...filters,
                      country: code,
                      continent: code === "ALL" ? filters.continent : groups.find((g) => g.country === code)?.continent ?? filters.continent,
                    })}
                  />
                </Section>
              )}
              <Section title={t.topTitle}>
                <TopGroups groups={filtered} onOpen={openFromAnywhere} />
              </Section>
            </div>

            <div ref={explorerRef} className="scroll-mt-4 [contain-intrinsic-size:auto_1600px] [content-visibility:auto]">
              <Section title={t.explorerTitle} sub={t.explorerSub}>
                <GroupExplorer
                  groups={filtered}
                  events={eventsByGroup}
                  openId={openId}
                  onOpen={(g) => setOpenId(g?.id ?? null)}
                  query={query}
                  onQuery={setQuery}
                  onClearFilters={() => changeFilters({ type: "ALL", continent: "ALL", country: "ALL" })}
                />
              </Section>
            </div>
          </>
        )}

        <footer className="space-y-2 border-t border-line pt-6 text-sm text-muted-fg">
          {data && <p>{t.source(date(data.generated))}</p>}
          <p className="max-w-[72ch] text-xs leading-relaxed">{t.method}</p>
          <p className="max-w-[72ch] text-xs">{t.disclaimer}</p>
          <p className="flex items-center gap-2 pt-2 text-xs">
            <GitHubIcon size={14} />
            <a href={REPO_URL} target="_blank" rel="noopener noreferrer" className="text-fg underline-offset-4 hover:underline">{t.repoCta}</a>
          </p>
        </footer>
      </main>

      <HoverLayer store={hoverStore} placeById={placeById} filters={filters} />
    </div>
  );
}
