export type GroupType = "SBG" | "UG";
export type Continent = "NA" | "LATAM" | "EU" | "AS" | "AF" | "OC";

export interface Group {
  id: string;
  name: string;
  url: string;
  city: string;
  country: string;
  continent: Continent;
  type: GroupType;
  meetups: number;
  reach: number;
  newMembers: number;
  members: number;
  lat: number;
  lng: number;
  geo: "exact" | "city" | "country";
}

/** [groupId, date, title, format (P|O|H), rsvps, eventId] */
export type EventRow = [string, string, string, string, number, string];

export interface Dataset {
  year: number;
  generated: string;
  groups: Group[];
}

export async function loadGroups(): Promise<Dataset> {
  const res = await fetch("/data/groups.json");
  if (!res.ok) throw new Error(`groups.json: ${res.status}`);
  return res.json();
}

export async function loadEvents(): Promise<EventRow[]> {
  const res = await fetch("/data/events.json");
  if (!res.ok) throw new Error(`events.json: ${res.status}`);
  return res.json();
}

export interface Filters {
  type: "ALL" | GroupType;
  continent: "ALL" | Continent;
  country: "ALL" | string;
}

export const matches = (g: Group, f: Filters) =>
  (f.type === "ALL" || g.type === f.type) &&
  (f.continent === "ALL" || g.continent === f.continent) &&
  (f.country === "ALL" || g.country === f.country);

export interface Totals {
  groups: number;
  active: number;
  countries: number;
  meetups: number;
  reach: number;
  newMembers: number;
}

export function totals(gs: Group[]): Totals {
  const countries = new Set<string>();
  let active = 0, meetups = 0, reach = 0, newMembers = 0;
  for (const g of gs) {
    if (g.meetups > 0) { active++; countries.add(g.country); }
    meetups += g.meetups;
    reach += g.reach;
    newMembers += g.newMembers;
  }
  return { groups: gs.length, active, countries: countries.size, meetups, reach, newMembers };
}

/** Grupos que comparten coordenadas = una ciudad en el globo. */
export interface Place {
  id: string;
  lat: number;
  lng: number;
  city: string;
  country: string;
  groups: Group[];
  meetups: number;
  sbg: number;
  ug: number;
}

export function places(gs: Group[]): Place[] {
  const map = new Map<string, Place>();
  for (const g of gs) {
    const key = `${g.lat},${g.lng}`;
    let p = map.get(key);
    if (!p) {
      p = { id: key, lat: g.lat, lng: g.lng, city: g.city, country: g.country, groups: [], meetups: 0, sbg: 0, ug: 0 };
      map.set(key, p);
    }
    p.groups.push(g);
    p.meetups += g.meetups;
    if (g.type === "SBG") p.sbg++; else p.ug++;
  }
  return [...map.values()];
}

export const CONTINENTS: Continent[] = ["NA", "LATAM", "EU", "AF", "AS", "OC"];

export const CONTINENT_CENTER: Record<Continent, { lat: number; lng: number }> = {
  NA: { lat: 42, lng: -98 },
  LATAM: { lat: -8, lng: -66 },
  EU: { lat: 50, lng: 14 },
  AF: { lat: 4, lng: 20 },
  AS: { lat: 24, lng: 88 },
  OC: { lat: -27, lng: 142 },
};

/** Centro de un conjunto de grupos (promedio de coordenadas sobre la esfera). */
export function centerOf(gs: Group[]): { lat: number; lng: number } | null {
  if (!gs.length) return null;
  let x = 0, y = 0, z = 0;
  for (const g of gs) {
    const la = (g.lat * Math.PI) / 180, lo = (g.lng * Math.PI) / 180;
    x += Math.cos(la) * Math.cos(lo);
    y += Math.cos(la) * Math.sin(lo);
    z += Math.sin(la);
  }
  return {
    lat: (Math.atan2(z, Math.hypot(x, y)) * 180) / Math.PI,
    lng: (Math.atan2(y, x) * 180) / Math.PI,
  };
}

export interface CountryStat {
  code: string;
  groups: number;
  active: number;
  meetups: number;
  reach: number;
  newMembers: number;
}

export function byCountry(gs: Group[]): CountryStat[] {
  const m = new Map<string, CountryStat>();
  for (const g of gs) {
    let c = m.get(g.country);
    if (!c) { c = { code: g.country, groups: 0, active: 0, meetups: 0, reach: 0, newMembers: 0 }; m.set(g.country, c); }
    c.groups++;
    if (g.meetups > 0) c.active++;
    c.meetups += g.meetups;
    c.reach += g.reach;
    c.newMembers += g.newMembers;
  }
  return [...m.values()].sort((a, b) => b.meetups - a.meetups || b.reach - a.reach);
}

/** Meetups por mes (0–11) separados por tipo de grupo. */
export function byMonth(events: EventRow[], groupById: Map<string, Group>, keep: (g: Group) => boolean) {
  const months = Array.from({ length: 12 }, () => ({ SBG: 0, UG: 0, reach: 0 }));
  for (const e of events) {
    const g = groupById.get(e[0]);
    if (!g || !keep(g)) continue;
    const mo = Number(e[1].slice(5, 7)) - 1;
    months[mo][g.type]++;
    months[mo].reach += e[4];
  }
  return months;
}

/** Meetups por día de la semana (0 = lunes) separados por tipo de grupo. */
export function byWeekday(events: EventRow[], groupById: Map<string, Group>, keep: (g: Group) => boolean) {
  const days = Array.from({ length: 7 }, () => ({ SBG: 0, UG: 0 }));
  for (const e of events) {
    const g = groupById.get(e[0]);
    if (!g || !keep(g)) continue;
    const d = new Date(e[1] + "T12:00:00Z").getUTCDay();
    days[(d + 6) % 7][g.type]++;
  }
  return days;
}
