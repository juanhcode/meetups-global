// Explorador de grupos. Patrón tomado del panel "Audit log" de Illos (código MIT):
// búsqueda, filtro segmentado con conteos, filas que se abren con el registro completo y exportación CSV.
// La ilustración original no se usa.
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import type { EventRow, Group } from "@/lib/data";
import { useI18n } from "@/lib/i18n";
import { Flag } from "@/components/flag";
import { cn } from "@/lib/utils";

export type SortKey = "meetups" | "reach" | "newMembers";
const PAGE = 40;
const SBG_COLOR = "#e3af35";
const UG_COLOR = "#e8e2d6";

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

interface Props {
  groups: Group[];
  events: Map<string, EventRow[]> | null;
  openId: string | null;
  onOpen: (g: Group | null) => void;
  query: string;
  onQuery: (q: string) => void;
  onClearFilters: () => void;
}

export function GroupExplorer({ groups, events, openId, onOpen, query, onQuery, onClearFilters }: Props) {
  const { t, num, country } = useI18n();
  const uid = useId();
  const [sort, setSort] = useState<SortKey>("meetups");
  const [limit, setLimit] = useState(PAGE);
  const [exported, setExported] = useState(false);
  const search = useRef<HTMLInputElement>(null);

  const q = norm(query.trim());
  const shown = useMemo(() => {
    const list = q
      ? groups.filter((g) => norm(`${g.name} ${g.city} ${country(g.country)} ${g.country}`).includes(q))
      : groups;
    return [...list].sort((a, b) => b[sort] - a[sort] || b.reach - a.reach || a.name.localeCompare(b.name));
  }, [groups, q, sort, country]);

  // Al cambiar filtros o búsqueda se vuelve a la primera página
  useEffect(() => setLimit(PAGE), [groups, q, sort]);

  // Si el grupo abierto está más abajo de la página visible, la extiende para mostrarlo
  useEffect(() => {
    if (!openId) return;
    const i = shown.findIndex((g) => g.id === openId);
    if (i >= limit) setLimit(i + 1);
  }, [openId, shown, limit]);

  useEffect(() => {
    if (!exported) return;
    const tm = setTimeout(() => setExported(false), 1600);
    return () => clearTimeout(tm);
  }, [exported]);

  const maxVal = Math.max(1, ...shown.map((g) => g[sort]));

  const exportCsv = () => {
    const rows = [
      ["rank", "group", "type", "city", "country", "meetups_2026", "rsvps_2026", "new_members_2026", "members", "url"],
      ...shown.map((g, i) => [i + 1, g.name, g.type, g.city, country(g.country), g.meetups, g.reach, g.newMembers, g.members, `https://www.meetup.com/${g.url}/`]),
    ];
    const csv = rows.map((r) => r.map((v) => `"${String(v).replaceAll('"', '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: "aws-community-groups-2026.csv" });
    a.click();
    URL.revokeObjectURL(url);
    setExported(true);
  };

  const sorts: { id: SortKey; label: string }[] = [
    { id: "meetups", label: t.sortMeetups },
    { id: "reach", label: t.sortReach },
    { id: "newMembers", label: t.sortNew },
  ];

  return (
    <div className="rounded-2xl border border-line bg-surface p-1.5">
      <div role="search" className="flex flex-col gap-2.5 p-2 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1">
          <label htmlFor={`${uid}-q`} className="sr-only">{t.searchPh}</label>
          <Icon className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-fg">
            <circle cx="11" cy="11" r="6.5" />
            <path d="m20 20-4.2-4.2" />
          </Icon>
          <input
            ref={search}
            id={`${uid}-q`}
            type="search"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder={t.searchPh}
            spellCheck={false}
            autoComplete="off"
            className="h-10 w-full rounded-lg bg-ink/70 pr-3 pl-9 text-base text-fg shadow-[inset_0_0_0_1px_var(--color-line)] outline-none placeholder:text-muted-fg focus-visible:shadow-[inset_0_0_0_1px_var(--color-amber)] sm:h-9 sm:text-sm [&::-webkit-search-cancel-button]:hidden"
          />
        </div>
        <fieldset className="flex shrink-0 overflow-x-auto rounded-lg bg-ink/70 p-0.5">
          <legend className="sr-only">Sort</legend>
          {sorts.map((s) => (
            <label
              key={s.id}
              className="relative flex cursor-pointer items-center rounded-md px-2.5 py-1.5 text-xs font-medium whitespace-nowrap text-muted-fg transition-colors select-none hover:text-fg has-[:checked]:bg-ink-2 has-[:checked]:text-fg has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-amber"
            >
              <input type="radio" name={`${uid}-sort`} value={s.id} checked={sort === s.id} onChange={() => setSort(s.id)} className="sr-only" />
              {s.label}
            </label>
          ))}
        </fieldset>
      </div>

      <div className="flex items-center justify-between px-3.5 pt-1 pb-2 text-xs text-muted-fg">
        <p aria-live="polite">{t.shownOf(num(Math.min(limit, shown.length)), num(shown.length))}</p>
        <button
          type="button"
          onClick={exportCsv}
          disabled={!shown.length}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 font-medium text-fg/85 transition-colors hover:bg-ink-2 hover:text-fg disabled:pointer-events-none disabled:opacity-50"
        >
          <Icon size={14}>{exported ? <path d="M20 6 9 17l-5-5" /> : <path d="M12 4v11m0 0-4-4m4 4 4-4M5 20h14" />}</Icon>
          {exported ? t.exported : t.exportCsv}
        </button>
      </div>

      {shown.length ? (
        <>
          <ol className="flex flex-col gap-0.5">
            {shown.slice(0, limit).map((g, i) => (
              <Row
                key={g.id}
                rank={i + 1}
                group={g}
                sort={sort}
                pct={(g[sort] / maxVal) * 100}
                open={openId === g.id}
                events={events?.get(g.id) ?? (events ? [] : null)}
                onToggle={() => onOpen(openId === g.id ? null : g)}
              />
            ))}
          </ol>
          {shown.length > limit && (
            <button
              type="button"
              onClick={() => setLimit((l) => l + PAGE * 2)}
              className="mx-auto my-3 flex rounded-full border border-line px-4 py-2 text-sm text-fg/85 transition-colors hover:border-fg/40 hover:text-fg"
            >
              {t.showMore(Math.min(PAGE * 2, shown.length - limit))}
            </button>
          )}
        </>
      ) : (
        <div className="flex min-h-[260px] flex-col items-center justify-center gap-3 px-6 text-center">
          <p className="text-sm font-medium">{t.noMatch(query.trim())}</p>
          <p className="max-w-[36ch] text-sm text-muted-fg">{t.noMatchHint}</p>
          <button
            type="button"
            onClick={() => { onQuery(""); onClearFilters(); search.current?.focus(); }}
            className="mt-1 inline-flex h-9 items-center rounded-lg bg-fg px-4 text-sm font-medium text-ink transition-transform active:scale-[0.97]"
          >
            {t.clearFilters}
          </button>
        </div>
      )}
    </div>
  );
}

function Row({ rank, group: g, sort, pct, open, events, onToggle }: {
  rank: number; group: Group; sort: SortKey; pct: number; open: boolean;
  events: EventRow[] | null; onToggle: () => void;
}) {
  const { t, num, country, shortDate } = useI18n();
  const id = useId();
  const ref = useRef<HTMLLIElement>(null);
  const color = g.type === "SBG" ? SBG_COLOR : UG_COLOR;

  // Cuando se abre desde el globo, la fila se trae a la vista
  useEffect(() => {
    if (open) ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [open]);

  const details: [string, ReactNode][] = [
    [t.sortMeetups, num(g.meetups)],
    [t.reach, num(g.reach)],
    [t.newMembers, num(g.newMembers)],
    [t.members, num(g.members)],
  ];

  return (
    <li ref={ref} className={cn("rounded-lg transition-colors duration-150", open && "bg-ink-2/60")}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={onToggle}
        className={cn("flex w-full items-center gap-3 rounded-lg px-2.5 py-2.5 text-left transition-colors hover:bg-ink-2/50", open && "hover:bg-transparent")}
      >
        <span className={cn("w-7 shrink-0 text-right text-xs tabular-nums", rank <= 3 && g[sort] > 0 ? "font-semibold text-fg" : "text-muted-fg")}>
          {rank}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="size-2 shrink-0 rounded-full" style={{ background: color }} aria-label={g.type} />
            <span className="truncate text-sm font-medium text-fg">{g.name}</span>
          </span>
          <span className="mt-0.5 block truncate pl-4 text-xs text-muted-fg">
            <Flag code={g.country} className="mr-1" />{g.city ? `${g.city}, ` : ""}{country(g.country)}
          </span>
          <span className="mt-1.5 ml-4 block h-1 rounded-full bg-ink/80">
            <span className="block h-full rounded-full" style={{ width: `${Math.max(pct, g[sort] ? 2 : 0)}%`, background: color, opacity: 0.8 }} />
          </span>
        </span>
        <span className="shrink-0 text-right">
          <span className="block text-sm font-semibold tabular-nums text-fg">{num(g[sort])}</span>
          <span className="block text-[11px] text-muted-fg">
            {sort === "meetups" ? t.sortMeetups.toLowerCase() : sort === "reach" ? t.reach : t.newMembers}
          </span>
        </span>
        <Icon className={cn("shrink-0 text-muted-fg transition-transform duration-200 motion-reduce:transition-none", open && "rotate-180")}>
          <path d="m6 9 6 6 6-6" />
        </Icon>
      </button>
      <div
        id={id}
        inert={!open}
        className={cn("grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none", open ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}
      >
        <div className="overflow-hidden">
          {open && (
            <div className="pr-3 pb-4 pl-12">
              <dl className="grid grid-cols-2 gap-x-6 gap-y-2 py-1 text-xs sm:grid-cols-4 sm:text-[13px]">
                {details.map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-muted-fg">{k}</dt>
                    <dd className="font-medium tabular-nums text-fg">{v}</dd>
                  </div>
                ))}
              </dl>
              {events === null ? (
                <p className="mt-3 text-xs text-muted-fg">{t.eventsLoading}</p>
              ) : events.length > 0 && (
                <table className="mt-3 w-full text-left text-xs">
                  <thead className="text-muted-fg">
                    <tr>
                      <th className="py-1.5 pr-3 font-normal">{t.evDate}</th>
                      <th className="py-1.5 pr-3 font-normal">{t.evTitle}</th>
                      <th className="hidden py-1.5 pr-3 font-normal sm:table-cell">{t.evFormat}</th>
                      <th className="py-1.5 text-right font-normal">{t.evRsvp}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...events].sort((a, b) => b[1].localeCompare(a[1])).map((e) => (
                      <tr key={e[5]} className="border-t border-line/60">
                        <td className="py-1.5 pr-3 whitespace-nowrap text-muted-fg tabular-nums">{shortDate(e[1])}</td>
                        <td className="py-1.5 pr-3">
                          <a
                            href={`https://www.meetup.com/${g.url}/events/${e[5]}/`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-fg/90 underline-offset-2 hover:text-fg hover:underline"
                          >
                            {e[2]}
                          </a>
                        </td>
                        <td className="hidden py-1.5 pr-3 whitespace-nowrap text-muted-fg sm:table-cell">{t.formats[e[3]] ?? "—"}</td>
                        <td className="py-1.5 text-right tabular-nums">{num(e[4])}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <a
                href={`https://www.meetup.com/${g.url}/`}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-amber hover:underline"
              >
                {t.openMeetup}
                <Icon size={12}><path d="M7 17 17 7M9 7h8v8" /></Icon>
              </a>
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

function Icon({ children, className, size = 16 }: { children: ReactNode; className?: string; size?: number }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      {children}
    </svg>
  );
}
