#!/usr/bin/env python3
"""
Prepara los datos para la web (web/public/data/*.json) a partir de la salida del scraper.

  python3 web/scripts/prepare_data.py

Entradas:  output/global_grupos_2026.json, output/global_eventos_2026.csv
Salidas:   web/public/data/groups.json  — grupos con lat/lng y métricas
           web/public/data/events.json  — eventos (columnas compactas)

Coordenadas: si el grupo ya trae lat/lon (scraper actualizado) se usan tal cual.
Si no, se busca su ciudad en las ciudades del scraper o en EXTRA_CITIES y, como
último recurso, se usa el centro del país con un pequeño desplazamiento estable.
"""
import csv, hashlib, json, math, os, re, shutil, unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT = os.path.join(HERE, "..", "public", "data")


def norm(s):
    return unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower().strip()


# Ciudades que no están en la lista de búsqueda del scraper pero sí aparecen en los grupos.
EXTRA_CITIES = {
    "noida": (28.54, 77.39), "kapra": (17.48, 78.56), "mexico city": (19.43, -99.13),
    "ni dilli": (28.61, 77.21), "dehra dun": (30.32, 78.03), "vadodara": (22.31, 73.18),
    "peshawar": (34.01, 71.58), "kanpur": (26.45, 80.33), "navi mumbai": (19.03, 73.03),
    "gurgaon": (28.46, 77.03), "patna": (25.59, 85.14), "surat": (21.17, 72.83),
    "faisalabad": (31.45, 73.13), "bangalore": (12.97, 77.59), "cordoba": (-31.42, -64.18),
    "mysore": (12.30, 76.64), "ho chi minh city": (10.82, 106.63), "ghaziabad": (28.67, 77.45),
    "madurai": (9.93, 78.12), "santa cruz": (-17.78, -63.18), "yaounde": (3.85, 11.50),
    "chattagam": (22.36, 91.78), "anand": (22.56, 72.95), "rajkot": (22.30, 70.80),
    "thiruvananthapuram": (8.52, 76.94), "tirupati": (13.63, 79.42), "allahabad": (25.44, 81.85),
    "sao jose dos campos": (-23.22, -45.90), "faridabad": (28.41, 77.32), "gorakhpur": (26.76, 83.37),
    "cochabamba": (-17.39, -66.16), "makati": (14.55, 121.02), "lalitpur": (27.67, 85.32),
    "tiruchchirappalli": (10.79, 78.70), "udaipur": (24.59, 73.71), "mohali": (30.70, 76.72),
    "tarija": (-21.53, -64.73), "aguascalientes": (21.88, -102.29), "joao pessoa": (-7.12, -34.86),
    "haridwar": (29.95, 78.16), "pokhara": (28.21, 83.99), "aracaju": (-10.91, -37.07),
    "sonipat": (28.99, 77.02), "rawalpindi": (33.60, 73.04), "sao luis": (-2.53, -44.30),
    "huancayo": (-12.07, -75.21), "gwalior": (26.22, 78.18), "meerut": (28.98, 77.71),
    "managua": (12.11, -86.24), "panvel": (18.99, 73.12), "koyampattur": (11.02, 76.96),
    "rurki": (29.85, 77.89), "pondicherry": (11.94, 79.81), "santos": (-23.96, -46.33),
    "pretoria": (-25.75, 28.19), "bandung": (-6.92, 107.61), "meru": (0.05, 37.65),
    "sambalpur": (21.47, 83.97), "uberlandia": (-18.92, -48.28), "joinville": (-26.30, -48.85),
    "jalandhar": (31.33, 75.58), "eldoret": (0.51, 35.27), "warangal": (17.97, 79.59),
    "thane": (19.22, 72.98), "malaga": (36.72, -4.42), "kumasi": (6.69, -1.62),
    "mississauga": (43.59, -79.64), "gandhinagar": (23.22, 72.65), "amritsar": (31.63, 74.87),
    "rabat": (34.02, -6.84), "waterloo": (43.46, -80.52), "kayseri": (38.73, 35.49),
    "campina grande": (-7.23, -35.88), "cotonou": (6.37, 2.39), "thanh pho ho chi minh": (10.82, 106.63),
    "baltimore": (39.29, -76.61), "pasadena": (34.15, -118.14), "lakhnau": (26.85, 80.95),
    "shah alam": (3.07, 101.52), "ibadan": (7.38, 3.94), "addis abeba": (9.03, 38.74),
    "sucre": (-19.04, -65.26), "buea": (4.16, 9.24), "vellore": (12.92, 79.13), "boulder": (40.01, -105.27),
    "nakuru": (-0.30, 36.07), "hermosillo": (29.07, -110.96), "panama": (8.98, -79.52),
    "manizales": (5.07, -75.52), "cuenca": (-2.90, -79.00), "chiclayo": (-6.77, -79.84),
    "ha noi": (21.03, 105.85), "roma": (41.90, 12.50), "san luis potosi": (22.16, -100.98),
    "cluj-napoca": (46.77, 23.60), "arequipa": (-16.41, -71.54), "villahermosa": (17.99, -92.93),
    "tempe": (33.43, -111.94), "prishtine": (42.66, 21.17), "quezon city": (14.68, 121.04),
    "kozhikode": (11.26, 75.78), "chihuahua": (28.63, -106.07), "dortmund": (51.51, 7.47),
    "alexandria": (31.20, 29.92), "tel aviv-yafo": (32.09, 34.78), "florianopolis": (-27.60, -48.55),
    "timisoara": (45.76, 21.23), "munchen": (48.14, 11.58), "strasbourg": (48.57, 7.75),
    "saltillo": (25.42, -101.00), "darmstadt": (49.87, 8.65), "dusseldorf": (51.23, 6.77),
    "glasgow": (55.86, -4.25), "milano": (45.46, 9.19), "torino": (45.07, 7.69), "pereira": (4.81, -75.69),
    "wollongong": (-34.42, 150.89), "thessaloniki": (40.64, 22.94), "hannover": (52.38, 9.73),
    "cartagena": (10.39, -75.51), "nottingham": (52.95, -1.15), "coventry": (52.41, -1.51),
    "dammam": (26.42, 50.09), "ludhiana": (30.90, 75.86), "srinagar": (34.08, 74.80),
    "rajshahi": (24.37, 88.60), "sfax": (34.74, 10.76), "lome": (6.13, 1.22), "al-jaza'ir": (36.75, 3.06),
}

# Centro aproximado de cada país (respaldo cuando no se conoce la ciudad).
COUNTRY_CENTER = {
    "ad": (42.5, 1.5), "ae": (24.3, 54.4), "am": (40.1, 45.0), "ao": (-11.2, 17.9), "ar": (-34.6, -64.0),
    "at": (47.5, 14.6), "au": (-25.3, 133.8), "az": (40.4, 47.6), "ba": (43.9, 17.7), "bd": (23.7, 90.4),
    "be": (50.5, 4.5), "bg": (42.7, 25.5), "bh": (26.0, 50.6), "bi": (-3.4, 29.9), "bj": (9.3, 2.3),
    "bo": (-16.3, -63.6), "br": (-14.2, -51.9), "ca": (49.0, -96.0), "cd": (-4.0, 21.8), "cg": (-0.2, 15.8),
    "ch": (46.8, 8.2), "ci": (7.5, -5.5), "cl": (-33.4, -70.7), "cm": (5.7, 12.4), "cn": (35.9, 104.2),
    "co": (4.6, -74.1), "cr": (9.9, -84.1), "cy": (35.1, 33.4), "cz": (49.8, 15.5), "de": (51.2, 10.4),
    "dk": (56.0, 10.0), "do": (18.7, -70.2), "dz": (36.0, 3.0), "ec": (-1.8, -78.2), "ee": (58.6, 25.0),
    "eg": (30.0, 31.2), "es": (40.4, -3.7), "et": (9.1, 40.5), "fi": (61.9, 25.7), "fr": (46.6, 2.2),
    "gb": (52.5, -1.5), "ge": (42.3, 43.4), "gh": (7.9, -1.0), "gr": (39.1, 21.8), "gt": (14.6, -90.5),
    "hk": (22.3, 114.2), "hn": (14.1, -87.2), "hr": (45.1, 15.2), "hu": (47.2, 19.5), "id": (-2.5, 118.0),
    "ie": (53.4, -8.2), "il": (31.5, 34.9), "in": (21.0, 78.0), "is": (64.1, -21.9), "it": (42.8, 12.6),
    "jm": (18.1, -77.3), "jo": (31.0, 36.0), "jp": (36.2, 138.3), "ke": (-0.0, 37.9), "kr": (36.5, 127.8),
    "kz": (48.0, 66.9), "la": (19.9, 102.5), "lb": (33.9, 35.9), "lk": (7.9, 80.8), "lt": (55.2, 23.9),
    "lv": (56.9, 24.6), "ma": (31.8, -7.1), "mk": (41.6, 21.7), "mm": (21.9, 95.9), "mt": (35.9, 14.4),
    "mu": (-20.3, 57.6), "mx": (23.6, -102.6), "my": (4.2, 101.9), "mz": (-18.7, 35.5), "na": (-22.0, 17.1),
    "ng": (9.1, 8.7), "ni": (12.9, -85.2), "nl": (52.1, 5.3), "no": (60.5, 8.5), "np": (28.4, 84.1),
    "nz": (-41.0, 174.0), "om": (21.5, 55.9), "pa": (8.5, -80.8), "pe": (-9.2, -75.0), "ph": (12.9, 121.8),
    "pk": (30.4, 69.3), "pl": (51.9, 19.1), "ps": (31.9, 35.2), "pt": (39.4, -8.2), "py": (-23.4, -58.4),
    "qa": (25.4, 51.2), "ro": (45.9, 25.0), "rs": (44.0, 21.0), "rw": (-1.9, 29.9), "sa": (23.9, 45.1),
    "se": (60.1, 18.6), "sg": (1.35, 103.8), "si": (46.2, 14.9), "sk": (48.7, 19.7), "sn": (14.5, -14.5),
    "sv": (13.8, -88.9), "sy": (34.8, 39.0), "tg": (8.6, 0.8), "th": (15.9, 101.0), "tn": (34.0, 9.5),
    "tr": (39.0, 35.2), "tz": (-6.4, 34.9), "ua": (48.4, 31.2), "ug": (1.4, 32.3), "us": (39.8, -98.6),
    "uy": (-32.5, -55.8), "uz": (41.4, 64.6), "ve": (6.4, -66.6), "vn": (14.1, 108.3), "xk": (42.6, 20.9),
    "za": (-30.6, 22.9), "zw": (-19.0, 29.2),
}

CONTINENT = {}
for k, codes in {
    "NA": "us ca",
    "LATAM": "mx gt hn sv ni cr pa cu do pr jm tt bs bb ht co ve ec pe bo cl ar uy py br",
    "EU": "gb ie fr de es pt it nl be lu ch at se no dk fi is pl cz sk hu ro bg gr hr si rs ba mk al me ua by md lt lv ee ru cy mt ad xk",
    "AS": "tr ge am az il ps jo lb sa ae qa kw bh om iq ir sy kz uz kg in pk bd lk np bt mv cn hk tw jp kr mn sg my th vn id ph kh la mm",
    "OC": "au nz fj pg",
    "AF": "eg ma dz tn ly ng gh ke tz ug rw et za zw zm na bw mz ao cm ci sn ml bf mu mg sd cd ne bj tg ga cg mw sl lr ss so dj bi",
}.items():
    for c in codes.split():
        CONTINENT[c] = k


def scraper_cities():
    src = open(os.path.join(ROOT, "scrape_global.py"), encoding="utf-8").read()
    block = src[src.index("CITIES = ["):src.index("QUERIES =")]
    return {norm(n): (float(a), float(b))
            for n, a, b in re.findall(r'\("([^"]+)",\s*(-?[\d.]+),\s*(-?[\d.]+)', block)}


def jitter(key, spread):
    h = hashlib.md5(key.encode()).digest()
    ang = h[0] / 255 * 2 * math.pi
    dist = spread * math.sqrt(h[1] / 255)
    return dist * math.sin(ang), dist * math.cos(ang)


def main():
    data = json.load(open(os.path.join(ROOT, "output", "global_grupos_2026.json"), encoding="utf-8"))
    cities = {**scraper_cities(), **EXTRA_CITIES}
    groups, stats = [], {"exact": 0, "city": 0, "country": 0}
    for g in data["grupos"]:
        if g.get("lat") is not None and g.get("lon") is not None:
            lat, lng, how = g["lat"], g["lon"], "exact"
        elif norm(g["ciudad"]) in cities:
            lat, lng = cities[norm(g["ciudad"])]
            how = "city"
        else:
            lat, lng = COUNTRY_CENTER.get(g["pais"], (0.0, 0.0))
            dy, dx = jitter(g["id"], 2.5)
            lat, lng, how = lat + dy, lng + dx, "country"
        stats[how] += 1
        groups.append({
            "id": g["id"], "name": g["nombre"], "url": g["urlname"], "city": g["ciudad"],
            "country": g["pais"], "continent": CONTINENT.get(g["pais"], "AS"), "type": g["tipo"],
            "meetups": g["meetups_2026"], "reach": g["alcance_2026"],
            "newMembers": g["miembros"], "members": g["miembros_total"],
            "lat": round(lat, 3), "lng": round(lng, 3), "geo": how,
        })

    ids = {(g["name"], g["country"]): g["id"] for g in groups}
    events = []
    with open(os.path.join(ROOT, "output", "global_eventos_2026.csv"), encoding="utf-8") as f:
        for e in csv.DictReader(f):
            gid = ids.get((e["grupo"], e["pais"]))
            if not gid:
                continue
            ev_id = e["url"].rstrip("/").rsplit("/", 1)[-1]
            # [groupId, fecha, título, formato, RSVP, eventId]
            events.append([gid, e["fecha"], e["titulo"], e["tipo_evento"][:1], int(e["asistentes"] or 0), ev_id])

    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, "groups.json"), "w", encoding="utf-8") as f:
        json.dump({"year": data["year"], "generated": data["generado"][:10], "groups": groups},
                  f, ensure_ascii=False, separators=(",", ":"))
    with open(os.path.join(OUT, "events.json"), "w", encoding="utf-8") as f:
        json.dump(events, f, ensure_ascii=False, separators=(",", ":"))
    # Banderas SVG (country-flag-icons, MIT): solo las de los países presentes
    flags_src = os.path.join(HERE, "..", "node_modules", "country-flag-icons", "3x2")
    flags_out = os.path.join(HERE, "..", "public", "flags")
    if os.path.isdir(flags_src):
        os.makedirs(flags_out, exist_ok=True)
        for c in {g["country"] for g in groups}:
            src = os.path.join(flags_src, c.upper() + ".svg")
            if os.path.exists(src):
                shutil.copyfile(src, os.path.join(flags_out, c + ".svg"))

    print(f"{len(groups)} grupos ({stats}) · {len(events)} eventos → {os.path.relpath(OUT, ROOT)}")


if __name__ == "__main__":
    main()
