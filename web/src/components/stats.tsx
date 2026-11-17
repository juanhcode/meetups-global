import { useState } from "react";
import { CONTINENTS, type Continent, type CountryStat, type Filters, type Group, type Totals } from "@/lib/data";
import { useI18n } from "@/lib/i18n";
import { Flag } from "@/components/flag";
import { cn } from "@/lib/utils";

export const SBG_COLOR = "#e3af35";
export const UG_COLOR = "#e8e2d6";

export function Section({ title, sub, children, id }: { title: string; sub?: string; children: React.ReactNode; id?: string }) {
  return (
    <section id={id} className="scroll-mt-6 border-t border-line pt-8">
      <h2 className="font-heading text-2xl font-semibold tracking-tight text-fg">{title}</h2>
      {sub && <p className="mt-1.5 max-w-[60ch] text-sm text-muted-fg">{sub}</p>}
      <div className="mt-5">{children}</div>
    </section>
  );
}

// ── Filtros ──────────────────────────────────────────────────────────────────

export function FilterBar({ filters, setFilters, countryOptions }: {
  filters: Filters;
  setFilters: (f: Filters) => void;
  countryOptions: { code: string; n: number }[];
}) {
  const { t, num, country } = useI18n();
  const types: { v: Filters["type"]; label: string; color?: string }[] = [
    { v: "ALL", label: t.all },
    { v: "SBG", label: t.sbg, color: SBG_COLOR },
    { v: "UG", label: t.ug, color: UG_COLOR },
  ];
  const regions: ("ALL" | Continent)[] = ["ALL", ...CONTINENTS];
  const dirty = filters.type !== "ALL" || filters.continent !== "ALL" || filters.country !== "ALL";
  const sortedCountries = [...countryOptions].sort((a, b) => country(a.code).localeCompare(country(b.code)));

  return (
    <div className="space-y-4">
      <fieldset>
        <legend className="mb-2 text-sm text-muted-fg">{t.filterType}</legend>
        <div className="flex flex-wrap gap-2">
          {types.map((o) => (
            <Chip key={o.v} active={filters.type === o.v} onClick={() => setFilters({ ...filters, type: o.v })}>
              {o.color ? (
                <span className="size-2.5 rounded-full" style={{ background: o.color }} />
              ) : (
                <span className="flex -space-x-1">
                  <span className="size-2.5 rounded-full" style={{ background: SBG_COLOR }} />
                  <span className="size-2.5 rounded-full" style={{ background: UG_COLOR }} />
                </span>
              )}
              {o.label}
            </Chip>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-2 text-sm text-muted-fg">{t.filterRegion}</legend>
        <div className="flex flex-wrap gap-2">
          {regions.map((r) => (
            <Chip
              key={r}
              small
              active={filters.continent === r}
              onClick={() => setFilters({ ...filters, continent: r, country: "ALL" })}
            >
              {r === "ALL" ? t.world : t.continents[r]}
            </Chip>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-wrap items-end gap-3">
        <label className="block min-w-0 flex-1">
          <span className="mb-2 block text-sm text-muted-fg">{t.filterCountry}</span>
          <select
            value={filters.country}
            onChange={(e) => setFilters({ ...filters, country: e.target.value })}
            className="h-10 w-full max-w-sm rounded-full border border-line bg-surface px-4 text-sm text-fg outline-none [&>option]:bg-raised hover:border-fg/40 focus-visible:border-amber"
          >
            <option value="ALL">{t.allCountries(countryOptions.length)}</option>
            {sortedCountries.map((c) => (
              <option key={c.code} value={c.code}>
                {country(c.code)} ({num(c.n)})
              </option>
            ))}
          </select>
        </label>
        {dirty && (
          <button
            type="button"
            onClick={() => setFilters({ type: "ALL", continent: "ALL", country: "ALL" })}
            className="h-10 rounded-full px-3 text-sm text-muted-fg underline-offset-4 hover:text-fg hover:underline"
          >
            {t.clearFilters}
          </button>
        )}
      </div>
    </div>
  );
}

function Chip({ active, onClick, children, small }: { active: boolean; onClick: () => void; children: React.ReactNode; small?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 rounded-full border transition-colors",
        small ? "px-3.5 py-1.5 text-[13px]" : "px-4 py-2 text-sm",
        active ? "border-fg bg-fg text-ink" : "border-line text-fg/80 hover:border-fg/40 hover:text-fg",
      )}
    >
      {children}
    </button>
  );
}

// ── KPIs ─────────────────────────────────────────────────────────────────────

export function Kpis({ sum, CountUp }: { sum: Totals; CountUp: React.ComponentType<{ value: number }> }) {
  const { t } = useI18n();
  const items: [number, string][] = [
    [sum.groups, t.kGroups],
    [sum.active, t.kActive],
    [sum.countries, t.kCountries],
    [sum.meetups, t.kMeetups],
    [sum.reach, t.kReach],
    [sum.newMembers, t.kNew],
  ];
  return (
    <dl className="grid grid-cols-2 border-t border-l border-line sm:grid-cols-3">
      {items.map(([v, label]) => (
        <div key={label} className="border-r border-b border-line px-4 py-5">
          <dd className="font-heading text-[clamp(1.7rem,3.2vw,2.4rem)] leading-none font-semibold tracking-tight text-fg">
            <CountUp value={v} />
          </dd>
          <dt className="mt-2 text-[13px] leading-snug text-muted-fg">{label}</dt>
        </div>
      ))}
    </dl>
  );
}

// ── Meetups por mes ──────────────────────────────────────────────────────────

export function MonthChart({ months }: { months: { SBG: number; UG: number; reach: number }[] }) {
  const { t, num, month } = useI18n();
  const max = Math.max(1, ...months.map((m) => m.SBG + m.UG));
  const now = new Date();
  const lastMonth = now.getFullYear() === 2026 ? now.getMonth() : 11;
  return (
    <div>
      <div className="flex h-64 items-end gap-1.5 sm:gap-3">
        {months.map((m, i) => {
          const total = m.SBG + m.UG;
          const future = i > lastMonth;
          return (
            <div key={i} className="group relative flex h-full flex-1 flex-col justify-end" aria-label={`${month(i)}: ${num(total)}`}>
              <span className="pointer-events-none absolute -top-1 left-1/2 z-10 -translate-x-1/2 -translate-y-full rounded-md bg-fg px-2 py-1 text-[11px] whitespace-nowrap text-ink opacity-0 transition-opacity group-hover:opacity-100">
                {num(m.SBG)} SBG, {num(m.UG)} UG
              </span>
              {!future && (
                <span className="mb-1 text-center text-[11px] tabular-nums text-muted-fg">{num(total)}</span>
              )}
              <div className={cn("flex flex-col overflow-hidden rounded-t-md", future && "opacity-30")} style={{ height: `${(total / max) * 100}%` }}>
                <div style={{ flex: m.UG, background: UG_COLOR }} />
                <div style={{ flex: m.SBG, background: SBG_COLOR }} />
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex gap-1.5 border-t border-line pt-2 sm:gap-2">
        {months.map((_, i) => (
          <span key={i} className={cn("flex-1 text-center text-[11px] text-muted-fg capitalize", i === lastMonth && "text-fg")}>
            {month(i).replace(".", "")}
          </span>
        ))}
      </div>
      <p className="mt-3 flex gap-4 text-xs text-muted-fg">
        <span className="flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ background: SBG_COLOR }} />{t.sbg}</span>
        <span className="flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ background: UG_COLOR }} />{t.ug}</span>
      </p>
    </div>
  );
}

// ── Países ───────────────────────────────────────────────────────────────────

export function CountryList({ stats, selected, onSelect }: { stats: CountryStat[]; selected: string; onSelect: (code: string) => void }) {
  const { t, num, country } = useI18n();
  const [all, setAll] = useState(false);
  const list = stats.filter((s) => s.meetups > 0);
  const shown = all ? list : list.slice(0, 10);
  const max = Math.max(1, ...list.map((s) => s.meetups));
  return (
    <div>
      <ol className="divide-y divide-line/70">
        {shown.map((s, i) => (
          <li key={s.code}>
            <button
              type="button"
              onClick={() => onSelect(selected === s.code ? "ALL" : s.code)}
              aria-pressed={selected === s.code}
              className={cn("flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-surface", selected === s.code && "bg-surface")}
            >
              <span className="w-6 text-right text-xs tabular-nums text-muted-fg">{i + 1}</span>
              <Flag code={s.code} className="h-4 w-6" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-fg">{country(s.code)}</span>
                <span className="mt-1 block h-1 rounded-full bg-surface">
                  <span className="block h-full rounded-full bg-amber" style={{ width: `${Math.max(2, (s.meetups / max) * 100)}%` }} />
                </span>
              </span>
              <span className="w-20 text-right">
                <span className="block text-sm font-semibold tabular-nums">{num(s.meetups)}</span>
                <span className="block text-[11px] text-muted-fg">{t.groupsIn(s.active)}</span>
              </span>
              <span className="hidden w-20 text-right sm:block">
                <span className="block text-sm tabular-nums">{num(s.reach)}</span>
                <span className="block text-[11px] text-muted-fg">{t.reach}</span>
              </span>
            </button>
          </li>
        ))}
      </ol>
      {list.length > 10 && (
        <button type="button" onClick={() => setAll(!all)} className="mt-3 text-sm text-amber underline-offset-4 hover:underline">
          {all ? t.showLess : t.showAll(list.length)}
        </button>
      )}
    </div>
  );
}

// ── Top grupos ───────────────────────────────────────────────────────────────

export function TopGroups({ groups, onOpen }: { groups: Group[]; onOpen: (g: Group) => void }) {
  const { t } = useI18n();
  const active = groups.filter((g) => g.meetups > 0);
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-8 sm:grid-cols-2">
      <TopList title={t.topByMeetups} list={[...active].sort((a, b) => b.meetups - a.meetups).slice(0, 10)} k="meetups" onOpen={onOpen} />
      <TopList title={t.topByReach} list={[...active].sort((a, b) => b.reach - a.reach).slice(0, 10)} k="reach" onOpen={onOpen} />
    </div>
  );
}

function TopList({ title, list, k, onOpen }: { title: string; list: Group[]; k: "meetups" | "reach"; onOpen: (g: Group) => void }) {
  const { num, country } = useI18n();
  const max = Math.max(1, ...list.map((g) => g[k]));
  return (
    <div>
      <h3 className="mb-3 text-sm font-medium text-fg">{title}</h3>
      <ol className="space-y-2.5">
        {list.map((g) => {
          const color = g.type === "SBG" ? SBG_COLOR : UG_COLOR;
          return (
            <li key={g.id}>
              <button type="button" onClick={() => onOpen(g)} className="group block w-full text-left">
                <span className="flex items-baseline justify-between gap-3 text-[13px]">
                  <span className="min-w-0 truncate text-fg/90 group-hover:text-fg group-hover:underline">{g.name}</span>
                  <span className="shrink-0 font-semibold tabular-nums">{num(g[k])}</span>
                </span>
                <span className="mt-1 flex items-center gap-2">
                  <span className="h-1.5 min-w-0 flex-1 rounded-full bg-surface">
                    <span className="block h-full rounded-full" style={{ width: `${(g[k] / max) * 100}%`, background: color }} />
                  </span>
                  <span className="shrink-0 text-[11px] whitespace-nowrap text-muted-fg"><Flag code={g.country} className="mr-1 h-2.5 w-[15px]" />{country(g.country)}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
