// Bento de estadísticas. Idea de layout inspirada en "Analytics Bento" (21st.dev, @romanvasnev, MIT);
// implementación propia con los datos de la comunidad. SVG puro, sin librería de gráficas.
import { useId, useLayoutEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from "react";
import type { CountryStat } from "@/lib/data";
import { useI18n } from "@/lib/i18n";
import { Flag } from "@/components/flag";
import { cn } from "@/lib/utils";

const SBG = "#e3af35";
const UG = "#e8e2d6";

export interface MonthPoint { SBG: number; UG: number; reach: number }
export interface DayPoint { SBG: number; UG: number }

// ── Utilidades ────────────────────────────────────────────────────────────────

type Pt = [number, number];

/** Curva suave que pasa por todos los puntos (Catmull-Rom → Bézier). */
function smoothPath(pts: Pt[], closed = false) {
  if (pts.length < 2) return "";
  const p = closed ? [pts[pts.length - 1], ...pts, pts[0], pts[1]] : [pts[0], ...pts, pts[pts.length - 1]];
  let d = `M${p[1][0]},${p[1][1]}`;
  const end = closed ? p.length - 2 : p.length - 2;
  for (let i = 1; i < end; i++) {
    const [x0, y0] = p[i - 1], [x1, y1] = p[i], [x2, y2] = p[i + 1], [x3, y3] = p[i + 2];
    const t = 1 / 6;
    d += ` C${x1 + (x2 - x0) * t},${y1 + (y2 - y0) * t} ${x2 - (x3 - x1) * t},${y2 - (y3 - y1) * t} ${x2},${y2}`;
  }
  return closed ? d + "Z" : d;
}

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn("relative overflow-hidden rounded-[22px] border border-line bg-surface p-5 sm:p-6", className)}>
      {children}
    </div>
  );
}

function Delta({ value }: { value: number | null }) {
  const { num } = useI18n();
  if (value === null || !isFinite(value)) return null;
  const up = value >= 0;
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-sm font-semibold tabular-nums", up ? "text-[#5fd68a]" : "text-[#ff8a7a]")}>
      <svg aria-hidden="true" viewBox="0 0 12 12" width="11" height="11" className={up ? "" : "rotate-180"}>
        <path d="M6 10V2M2.5 5.5 6 2l3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {num(Math.round(Math.abs(value) * 10) / 10)}%
    </span>
  );
}

// ── Gráfica de línea con scrub ───────────────────────────────────────────────

interface Series { key: string; color: string; values: number[]; area?: boolean; label: string }

function LineChart({ series, labels, height = 150, width = 520, current }: { series: Series[]; labels: string[]; height?: number; width?: number; current: number }) {
  const { num } = useI18n();
  const gid = useId();
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const W = width, H = height, padL = 6, padR = 44, padT = 14, padB = 22;
  const n = Math.min(labels.length, current + 1);
  const max = niceMax(Math.max(1, ...series.flatMap((s) => s.values.slice(0, n))));
  const x = (i: number) => padL + (i / Math.max(1, labels.length - 1)) * (W - padL - padR);
  const y = (v: number) => padT + (1 - v / max) * (H - padT - padB);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((k) => k * max);
  const idx = hover ?? n - 1;

  const onMove = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const i = Math.round(((px - padL) / (W - padL - padR)) * (labels.length - 1));
    setHover(Math.max(0, Math.min(n - 1, i)));
  };

  return (
    <div className="relative">
      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full touch-pan-y select-none"
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
        role="img"
        aria-label={series.map((s) => `${s.label}: ${s.values.slice(0, n).join(", ")}`).join("; ")}
      >
        <defs>
          {series.filter((s) => s.area).map((s) => (
            <linearGradient key={s.key} id={`${gid}-${s.key}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor={s.color} stopOpacity="0.32" />
              <stop offset="1" stopColor={s.color} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - padR + 6} y1={y(t)} y2={y(t)} stroke="rgb(255 255 255 / 0.06)" />
            <text x={W - 4} y={y(t) + 3.5} textAnchor="end" className="fill-muted-fg text-[10px] tabular-nums">{num(Math.round(t))}</text>
          </g>
        ))}
        {series.map((s) => {
          const pts: Pt[] = s.values.slice(0, n).map((v, i) => [x(i), y(v)]);
          // El último mes aún no termina: se dibuja aparte, punteado
          const done = current < labels.length - 1 || n < labels.length ? pts.slice(0, -1) : pts;
          const solid = smoothPath(done);
          const tail = done.length < pts.length && done.length ? `M${done[done.length - 1][0]},${done[done.length - 1][1]} L${pts[pts.length - 1][0]},${pts[pts.length - 1][1]}` : "";
          return (
            <g key={s.key}>
              {s.area && pts.length > 1 && (
                <path d={`${solid} L${pts[pts.length - 1][0]},${pts[pts.length - 1][1]} L${pts[pts.length - 1][0]},${y(0)} L${pts[0][0]},${y(0)} Z`} fill={`url(#${gid}-${s.key})`} />
              )}
              <path d={solid} fill="none" stroke={s.color} strokeWidth="2.2" strokeLinecap="round" />
              {tail && <path d={tail} fill="none" stroke={s.color} strokeWidth="2" strokeDasharray="3 4" strokeLinecap="round" opacity="0.8" />}
            </g>
          );
        })}
        <line x1={x(idx)} x2={x(idx)} y1={padT} y2={y(0)} stroke="rgb(255 255 255 / 0.22)" strokeDasharray="3 3" />
        {series.map((s) => (
          <circle key={s.key} cx={x(idx)} cy={y(s.values[idx] ?? 0)} r="4.2" fill={s.color} stroke="#1a1a1f" strokeWidth="2" />
        ))}
        {labels.map((l, i) => (i % 2 === 0 || i === labels.length - 1) && (
          <text key={i} x={x(i)} y={H - 5} textAnchor="middle" className={cn("text-[10px] capitalize", i === idx ? "fill-fg" : "fill-muted-fg")}>{l}</text>
        ))}
      </svg>
      <div className="pointer-events-none mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <span className="font-medium text-fg capitalize">{labels[idx]}</span>
        {series.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5 text-muted-fg">
            <span className="h-0.5 w-3 rounded-full" style={{ background: s.color }} />
            {s.label} <span className="font-semibold text-fg tabular-nums">{num(s.values[idx] ?? 0)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Treemap (squarified) ─────────────────────────────────────────────────────

interface Rect { key: string; x: number; y: number; w: number; h: number; value: number }

function squarify(items: { key: string; value: number }[], x: number, y: number, w: number, h: number): Rect[] {
  const total = items.reduce((s, i) => s + i.value, 0);
  if (!items.length || total <= 0) return [];
  const scale = (w * h) / total;
  const nodes = items.map((i) => ({ ...i, area: i.value * scale }));
  const out: Rect[] = [];
  let rx = x, ry = y, rw = w, rh = h;
  let row: typeof nodes = [];
  const worst = (r: typeof nodes, side: number) => {
    const s = r.reduce((a, b) => a + b.area, 0);
    const mx = Math.max(...r.map((n) => n.area)), mn = Math.min(...r.map((n) => n.area));
    return Math.max((side * side * mx) / (s * s), (s * s) / (side * side * mn));
  };
  const layoutRow = (r: typeof nodes) => {
    const s = r.reduce((a, b) => a + b.area, 0);
    if (rw >= rh) {
      const cw = s / rh;
      let cy = ry;
      for (const n of r) { const ch = n.area / cw; out.push({ key: n.key, x: rx, y: cy, w: cw, h: ch, value: n.value }); cy += ch; }
      rx += cw; rw -= cw;
    } else {
      const ch = s / rw;
      let cx = rx;
      for (const n of r) { const cw = n.area / ch; out.push({ key: n.key, x: cx, y: ry, w: cw, h: ch, value: n.value }); cx += cw; }
      ry += ch; rh -= ch;
    }
  };
  for (const node of nodes) {
    const side = Math.min(rw, rh);
    if (!row.length || worst([...row, node], side) <= worst(row, side)) row.push(node);
    else { layoutRow(row); row = [node]; }
  }
  if (row.length) layoutRow(row);
  return out;
}

const TOP = 16;

type TreeMetric = "meetups" | "reach" | "active";

function CountryTreemap({ stats, onSelect }: { stats: CountryStat[]; onSelect: (code: string) => void }) {
  const { t, num, country } = useI18n();
  const [metric, setMetric] = useState<TreeMetric>("meetups");
  const rects = useMemo(() => {
    const sorted = [...stats].filter((s) => s[metric] > 0).sort((a, b) => b[metric] - a[metric]);
    const top = sorted.slice(0, TOP).map((s) => ({ key: s.code, value: s[metric] }));
    return squarify(top, 0, 0, 100, 100);
  }, [stats, metric]);
  const max = Math.max(1, ...rects.map((r) => r.value));
  const shown = stats.filter((s) => s[metric] > 0).length;
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 600, h: 360 });
  const [tip, setTip] = useState<Rect | null>(null);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const r0 = el.getBoundingClientRect();
    setSize({ w: r0.width, h: r0.height });
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const metrics: { id: TreeMetric; label: string }[] = [
    { id: "meetups", label: t.sortMeetups },
    { id: "reach", label: t.reach },
    { id: "active", label: t.bentoGroups },
  ];
  const metricLabel = metric === "reach" ? t.reach : metrics.find((m) => m.id === metric)!.label.toLowerCase();

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm text-muted-fg">{t.bentoWhereTitle}</h3>
          <p className="mt-1 text-xs text-muted-fg">{t.bentoWhereSub(Math.min(TOP, shown), shown)}</p>
        </div>
        <div className="flex rounded-full border border-line bg-ink/60 p-0.5 text-xs" role="radiogroup">
          {metrics.map((m) => (
            <button
              key={m.id}
              role="radio"
              aria-checked={metric === m.id}
              onClick={() => setMetric(m.id)}
              className={cn("rounded-full px-3 py-1 font-medium transition-colors", metric === m.id ? "bg-ink-2 text-fg" : "text-muted-fg hover:text-fg")}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>
      <div ref={box} className="relative mt-4 h-[320px] rounded-xl sm:h-[360px]" onPointerLeave={() => setTip(null)}>
        {rects.map((r) => {
          const k = 0.22 + 0.78 * Math.sqrt(r.value / max);
          const dark = k > 0.62;
          // Tamaño real del cuadro en píxeles para elegir la etiqueta que cabe
          const pw = (r.w / 100) * size.w - 4, ph = (r.h / 100) * size.h - 4;
          const name = country(r.key);
          // ¿Cabe el nombre completo sin partir palabras? (≈6.7px por carácter a 12px; bandera + márgenes ≈ 40px)
          const textW = pw - 44;
          const longest = Math.max(...name.split(/\s+/).map((w) => w.length));
          const lines = Math.ceil((name.length * 7.2) / Math.max(1, textW));
          const fitsName = longest * 7.2 <= textW && (lines === 1 ? ph >= 30 : lines === 2 && ph >= 44);
          const label: "full" | "code" | "flag" = fitsName ? "full" : pw >= 60 && ph >= 26 ? "code" : "flag";
          const showValue = label === "full" && ph >= (lines > 1 ? 80 : 66);
          const fg = dark ? "text-ink" : "text-fg";
          return (
            <button
              key={r.key}
              type="button"
              onClick={() => onSelect(r.key)}
              onPointerEnter={() => setTip(r)}
              onFocus={() => setTip(r)}
              onBlur={() => setTip(null)}
              aria-label={`${name}: ${num(r.value)} ${metricLabel}`}
              className="group absolute p-[2px] text-left transition-[left,top,width,height] duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] focus-visible:z-10 motion-reduce:transition-none"
              style={{ left: `${r.x}%`, top: `${r.y}%`, width: `${r.w}%`, height: `${r.h}%` }}
            >
              <span
                className={cn(
                  "flex h-full w-full overflow-hidden rounded-lg transition-[filter] group-hover:brightness-110",
                  label === "flag" ? "items-center justify-center p-1" : "flex-col justify-between p-2",
                )}
                style={{ background: `color-mix(in oklab, ${SBG} ${Math.round(k * 100)}%, #1a1a1f)` }}
              >
                {label === "flag" && <Flag code={r.key} className={pw < 22 || ph < 14 ? "h-2 w-3" : ""} />}
                {label === "code" && (
                  <span className={cn("flex items-center gap-1.5 text-xs font-semibold", fg)}>
                    <Flag code={r.key} />
                    {r.key.toUpperCase()}
                  </span>
                )}
                {label === "full" && (
                  <span className={cn("flex min-w-0 items-start gap-1.5 text-xs leading-tight font-medium", fg)}>
                    <Flag code={r.key} className="mt-px" />
                    <span className="line-clamp-2">{name}</span>
                  </span>
                )}
                {showValue && (
                  <span className={cn("font-heading text-lg leading-none font-semibold tabular-nums sm:text-xl", fg)}>{num(r.value)}</span>
                )}
              </span>
            </button>
          );
        })}
        {tip && (
          <div
            className="pointer-events-none absolute z-20 w-max max-w-[220px] -translate-x-1/2 -translate-y-[calc(100%+8px)] rounded-xl border border-line-strong bg-raised px-3 py-2 shadow-[0_12px_30px_-10px_rgb(0_0_0/0.7)]"
            style={{
              left: `${Math.min(88, Math.max(12, tip.x + tip.w / 2))}%`,
              top: `${tip.y < 18 ? tip.y + tip.h : tip.y}%`,
              transform: tip.y < 18 ? "translate(-50%, 8px)" : undefined,
            }}
          >
            <p className="flex items-center gap-1.5 text-sm font-medium text-fg"><Flag code={tip.key} />{country(tip.key)}</p>
            <p className="mt-0.5 text-xs text-muted-fg"><b className="font-semibold text-fg tabular-nums">{num(tip.value)}</b> {metricLabel}</p>
          </div>
        )}
      </div>
    </>
  );
}

// ── Radar ────────────────────────────────────────────────────────────────────

function Radar({ days, labels }: { days: DayPoint[]; labels: string[] }) {
  const { t, num } = useI18n();
  const [hover, setHover] = useState<number | null>(null);
  const S = 260, c = S / 2, R = 92;
  const totS = days.reduce((a, d) => a + d.SBG, 0) || 1;
  const totU = days.reduce((a, d) => a + d.UG, 0) || 1;
  const shareS = days.map((d) => d.SBG / totS), shareU = days.map((d) => d.UG / totU);
  const max = Math.max(...shareS, ...shareU, 0.01);
  const pt = (i: number, v: number): Pt => {
    const a = -Math.PI / 2 + (i / days.length) * Math.PI * 2;
    const r = (v / max) * R;
    return [c + Math.cos(a) * r, c + Math.sin(a) * r];
  };
  const pct = (v: number) => `${num(Math.round(v * 1000) / 10)}%`;

  return (
    <div className="flex flex-col items-center">
      <svg viewBox={`0 0 ${S} ${S}`} className="h-auto w-full max-w-[300px]" role="img" aria-label={labels.map((l, i) => `${l}: SBG ${pct(shareS[i])}, UG ${pct(shareU[i])}`).join("; ")}>
        {[0.25, 0.5, 0.75, 1].map((k) => (
          <path key={k} d={smoothPath(days.map((_, i) => pt(i, max * k)), true)} fill="none" stroke="rgb(255 255 255 / 0.07)" />
        ))}
        {days.map((_, i) => {
          const [ex, ey] = pt(i, max);
          const [lx, ly] = pt(i, max * 1.2);
          return (
            <g key={i} onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)}>
              <line x1={c} y1={c} x2={ex} y2={ey} stroke="rgb(255 255 255 / 0.07)" />
              <text x={lx} y={ly + 3.5} textAnchor="middle" className={cn("text-[11px] capitalize", hover === i ? "fill-fg" : "fill-muted-fg")}>{labels[i]}</text>
              <circle cx={lx} cy={ly} r="16" fill="transparent" />
            </g>
          );
        })}
        <path d={smoothPath(shareU.map((v, i) => pt(i, v)), true)} fill={UG} fillOpacity="0.12" stroke={UG} strokeWidth="1.8" />
        <path d={smoothPath(shareS.map((v, i) => pt(i, v)), true)} fill={SBG} fillOpacity="0.2" stroke={SBG} strokeWidth="2" />
        {hover !== null && (
          <>
            <circle cx={pt(hover, shareS[hover])[0]} cy={pt(hover, shareS[hover])[1]} r="4" fill={SBG} stroke="#1a1a1f" strokeWidth="2" />
            <circle cx={pt(hover, shareU[hover])[0]} cy={pt(hover, shareU[hover])[1]} r="4" fill={UG} stroke="#1a1a1f" strokeWidth="2" />
          </>
        )}
      </svg>
      <div className="mt-2 flex min-h-5 flex-wrap justify-center gap-x-4 text-xs text-muted-fg">
        {hover === null ? (
          <span>{t.bentoRadarHint}</span>
        ) : (
          <>
            <span className="font-medium text-fg capitalize">{labels[hover]}</span>
            <span>SBG <b className="text-fg tabular-nums">{pct(shareS[hover])}</b></span>
            <span>UG <b className="text-fg tabular-nums">{pct(shareU[hover])}</b></span>
          </>
        )}
      </div>
    </div>
  );
}

// ── Bento ────────────────────────────────────────────────────────────────────

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function AnalyticsBento({ months, days, countries, totalMeetups, totalReach, onSelectCountry, CountUp }: {
  months: MonthPoint[];
  days: DayPoint[];
  countries: CountryStat[];
  totalMeetups: number;
  totalReach: number;
  onSelectCountry: (code: string) => void;
  CountUp: ComponentType<{ value: number }>;
}) {
  const { t, month, weekday, num } = useI18n();
  const now = new Date();
  const current = now.getFullYear() === 2026 ? now.getMonth() : 11;
  const labels = months.map((_, i) => month(i).replace(".", ""));
  const total = months.map((m) => m.SBG + m.UG);
  // Último mes completo contra el anterior
  const last = Math.max(1, current - 1);
  const delta = total[last - 1] ? ((total[last] - total[last - 1]) / total[last - 1]) * 100 : null;
  const avg = totalMeetups ? Math.round(totalReach / totalMeetups) : 0;
  const sbgTotal = months.reduce((a, m) => a + m.SBG, 0);
  const ugTotal = months.reduce((a, m) => a + m.UG, 0);
  // Lunes primero
  const dayLabels = days.map((_, i) => weekday(i));

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-12">
      <Card className="lg:col-span-7">
        <div className="flex h-full flex-col">
          <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
            <div>
              <h3 className="text-sm text-muted-fg">{t.bentoMeetupsTitle}</h3>
              <p className="mt-2 font-heading text-[2.8rem] leading-none font-semibold tracking-tight"><CountUp value={totalMeetups} /></p>
              <p className="mt-3 flex items-center gap-2 text-xs text-muted-fg">
                <Delta value={delta} /> <span>{t.bentoVs(cap(labels[last]), cap(labels[last - 1]))}</span>
              </p>
            </div>
            <p className="text-right text-xs text-muted-fg">
              {t.bentoAvg}
              <span className="mt-1 block font-heading text-2xl leading-none font-semibold text-fg tabular-nums">{num(avg)}</span>
            </p>
          </div>
          <div className="mt-5 flex-1 rounded-2xl border border-line bg-ink/40 p-3">
            <LineChart labels={labels} current={current} width={720} height={270} series={[{ key: "all", color: SBG, values: total, area: true, label: t.kMeetups }]} />
          </div>
        </div>
      </Card>

      <Card className="lg:col-span-5">
        <h3 className="text-sm text-muted-fg">{t.bentoDayTitle}</h3>
        <p className="mt-1 text-xs text-muted-fg">{t.bentoDaySub}</p>
        <div className="mt-3"><Radar days={days} labels={dayLabels} /></div>
        <p className="mt-3 flex justify-center gap-4 text-xs text-muted-fg">
          <span className="flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ background: SBG }} />{t.sbg}</span>
          <span className="flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ background: UG }} />{t.ug}</span>
        </p>
      </Card>

      <Card className="lg:col-span-5">
        <h3 className="text-sm text-muted-fg">{t.bentoTypesTitle}</h3>
        <div className="mt-2 flex flex-wrap items-end gap-x-8 gap-y-2">
          <p>
            <span className="flex items-center gap-1.5 text-xs text-muted-fg"><span className="size-2 rounded-full" style={{ background: SBG }} />SBG</span>
            <span className="mt-1 block font-heading text-[2.2rem] leading-none font-semibold tracking-tight"><CountUp value={sbgTotal} /></span>
          </p>
          <p>
            <span className="flex items-center gap-1.5 text-xs text-muted-fg"><span className="size-2 rounded-full" style={{ background: UG }} />UG</span>
            <span className="mt-1 block font-heading text-[2.2rem] leading-none font-semibold tracking-tight"><CountUp value={ugTotal} /></span>
          </p>
        </div>
        <div className="mt-5 rounded-2xl border border-line bg-ink/40 p-3">
          <LineChart
            labels={labels}
            current={current}
            height={230}
            series={[
              { key: "sbg", color: SBG, values: months.map((m) => m.SBG), label: "SBG" },
              { key: "ug", color: UG, values: months.map((m) => m.UG), label: "UG" },
            ]}
          />
        </div>
        <p className="mt-2 text-xs text-muted-fg">{t.bentoTypesSub}</p>
      </Card>

      <Card className="lg:col-span-7">
        <CountryTreemap stats={countries} onSelect={onSelectCountry} />
      </Card>
    </div>
  );
}
