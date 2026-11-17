#!/usr/bin/env python3
"""
Scraper GLOBAL — AWS Community (SBG + UG)

Descubre grupos AWS en todo el mundo con la búsqueda pública de Meetup
(sin login), descarga sus eventos PAST del año objetivo, el total de miembros
y los miembros NUEVOS del año (joinTime), y genera index.html.

Notas sobre el descubrimiento:
  * groupSearch devuelve como máximo 200 resultados por consulta y el ranking es
    difuso (mezcla grupos que solo mencionan "AWS"). Por eso se consulta desde
    ~250 ciudades con varias frases de búsqueda y se filtra por nombre/urlname.
  * Además se unen los grupos ya conocidos del proyecto ../meetups-latam
    (output/latam_grupos_2026.json) para no perder cobertura en LATAM.
  * La cobertura es de mejor esfuerzo: puede faltar algún grupo que no aparezca
    en ninguna de las búsquedas.

Salidas:
  output/global_grupos_2026.json  — datos por grupo con métricas
  output/global_eventos_2026.csv  — detalle evento a evento
  index.html                      — página web interactiva
"""

import json, csv, time, ssl, urllib.request, os, re, sys
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed

try:
    import certifi; SSL_CTX = ssl.create_default_context(cafile=certifi.where())
except Exception:
    SSL_CTX = ssl.create_default_context()
    SSL_CTX.check_hostname = False
    SSL_CTX.verify_mode = ssl.CERT_NONE

GQL = "https://api.meetup.com/gql-ext"
YEAR = 2026
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "output")
LATAM_JSON = os.path.join(HERE, "..", "meetups-latam", "output", "latam_grupos_2026.json")
WORKERS = 6

HEAD = {
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    "Origin": "https://www.meetup.com",
}

# Código ISO-2 (minúscula, como lo devuelve Meetup) -> nombre en español.
# Si falta un país se muestra el código en mayúsculas.
COUNTRIES = {
    "us": "Estados Unidos", "ca": "Canadá", "mx": "México", "gt": "Guatemala", "hn": "Honduras",
    "sv": "El Salvador", "ni": "Nicaragua", "cr": "Costa Rica", "pa": "Panamá", "cu": "Cuba",
    "do": "Rep. Dominicana", "pr": "Puerto Rico", "jm": "Jamaica", "tt": "Trinidad y Tobago",
    "bs": "Bahamas", "bb": "Barbados", "ht": "Haití",
    "co": "Colombia", "ve": "Venezuela", "ec": "Ecuador", "pe": "Perú", "bo": "Bolivia",
    "cl": "Chile", "ar": "Argentina", "uy": "Uruguay", "py": "Paraguay", "br": "Brasil",
    "gb": "Reino Unido", "ie": "Irlanda", "fr": "Francia", "de": "Alemania", "es": "España",
    "pt": "Portugal", "it": "Italia", "nl": "Países Bajos", "be": "Bélgica", "lu": "Luxemburgo",
    "ch": "Suiza", "at": "Austria", "se": "Suecia", "no": "Noruega", "dk": "Dinamarca",
    "fi": "Finlandia", "is": "Islandia", "pl": "Polonia", "cz": "Chequia", "sk": "Eslovaquia",
    "hu": "Hungría", "ro": "Rumania", "bg": "Bulgaria", "gr": "Grecia", "hr": "Croacia",
    "si": "Eslovenia", "rs": "Serbia", "ba": "Bosnia y Herz.", "mk": "Macedonia del Norte",
    "al": "Albania", "me": "Montenegro", "ua": "Ucrania", "by": "Bielorrusia", "md": "Moldavia",
    "lt": "Lituania", "lv": "Letonia", "ee": "Estonia", "ru": "Rusia", "tr": "Turquía",
    "cy": "Chipre", "mt": "Malta", "ge": "Georgia", "am": "Armenia", "az": "Azerbaiyán",
    "il": "Israel", "ps": "Palestina", "jo": "Jordania", "lb": "Líbano", "sa": "Arabia Saudita",
    "ae": "Emiratos Árabes", "qa": "Catar", "kw": "Kuwait", "bh": "Baréin", "om": "Omán",
    "iq": "Irak", "ir": "Irán", "kz": "Kazajistán", "uz": "Uzbekistán", "kg": "Kirguistán",
    "in": "India", "pk": "Pakistán", "bd": "Bangladés", "lk": "Sri Lanka", "np": "Nepal",
    "bt": "Bután", "mv": "Maldivas", "cn": "China", "hk": "Hong Kong", "tw": "Taiwán",
    "jp": "Japón", "kr": "Corea del Sur", "mn": "Mongolia", "sg": "Singapur", "my": "Malasia",
    "th": "Tailandia", "vn": "Vietnam", "id": "Indonesia", "ph": "Filipinas", "kh": "Camboya",
    "la": "Laos", "mm": "Myanmar", "au": "Australia", "nz": "Nueva Zelanda", "fj": "Fiyi",
    "pg": "Papúa N. Guinea", "eg": "Egipto", "ma": "Marruecos", "dz": "Argelia", "tn": "Túnez",
    "ly": "Libia", "ng": "Nigeria", "gh": "Ghana", "ke": "Kenia", "tz": "Tanzania",
    "ug": "Uganda", "rw": "Ruanda", "et": "Etiopía", "za": "Sudáfrica", "zw": "Zimbabue",
    "zm": "Zambia", "na": "Namibia", "bw": "Botsuana", "mz": "Mozambique", "ao": "Angola",
    "cm": "Camerún", "ci": "Costa de Marfil", "sn": "Senegal", "ml": "Mali", "bf": "Burkina Faso",
    "mu": "Mauricio", "mg": "Madagascar", "sd": "Sudán", "cd": "R. D. Congo", "ne": "Níger",
    "bj": "Benín", "tg": "Togo", "ga": "Gabón", "cg": "Congo", "mw": "Malaui", "sl": "Sierra Leona",
    "lr": "Liberia", "ss": "Sudán del Sur", "so": "Somalia", "dj": "Yibuti",
    "ad": "Andorra", "bi": "Burundi", "sy": "Siria", "xk": "Kosovo",
}

# (nombre, lat, lon, radio_km) — metros y regiones donde hay comunidad AWS.
CITIES = [
    # Estados Unidos
    ("New York", 40.71, -74.00, 120), ("Boston", 42.36, -71.06, 120), ("Philadelphia", 39.95, -75.17, 120),
    ("Washington DC", 38.90, -77.04, 120), ("Pittsburgh", 40.44, -80.00, 150), ("Charlotte", 35.23, -80.84, 150),
    ("Raleigh", 35.78, -78.64, 150), ("Atlanta", 33.75, -84.39, 150), ("Miami", 25.76, -80.19, 150),
    ("Orlando", 28.54, -81.38, 150), ("Tampa", 27.95, -82.46, 150), ("Nashville", 36.16, -86.78, 150),
    ("Chicago", 41.88, -87.63, 150), ("Detroit", 42.33, -83.05, 150), ("Columbus", 39.96, -83.00, 150),
    ("Cleveland", 41.50, -81.69, 150), ("Cincinnati", 39.10, -84.51, 150), ("Indianapolis", 39.77, -86.16, 150),
    ("Minneapolis", 44.98, -93.27, 150), ("St. Louis", 38.63, -90.20, 150), ("Kansas City", 39.10, -94.58, 150),
    ("Dallas", 32.78, -96.80, 150), ("Houston", 29.76, -95.37, 150), ("Austin", 30.27, -97.74, 150),
    ("San Antonio", 29.42, -98.49, 150), ("Oklahoma City", 35.47, -97.52, 200), ("Denver", 39.74, -104.99, 200),
    ("Salt Lake City", 40.76, -111.89, 200), ("Phoenix", 33.45, -112.07, 200), ("Las Vegas", 36.17, -115.14, 200),
    ("Los Angeles", 34.05, -118.24, 150), ("San Diego", 32.72, -117.16, 150), ("San Francisco", 37.77, -122.42, 100),
    ("San Jose", 37.34, -121.89, 80), ("Sacramento", 38.58, -121.49, 150), ("Portland", 45.52, -122.68, 150),
    ("Seattle", 47.61, -122.33, 150), ("Boise", 43.62, -116.20, 250), ("Albuquerque", 35.08, -106.65, 250),
    ("New Orleans", 29.95, -90.07, 200), ("Honolulu", 21.31, -157.86, 200), ("Anchorage", 61.22, -149.90, 300),
    ("Omaha", 41.26, -95.93, 250), ("Louisville", 38.25, -85.76, 200), ("Richmond", 37.54, -77.44, 150),
    # Canadá
    ("Toronto", 43.65, -79.38, 150), ("Montreal", 45.50, -73.57, 150), ("Ottawa", 45.42, -75.70, 150),
    ("Vancouver", 49.28, -123.12, 150), ("Calgary", 51.05, -114.07, 200), ("Edmonton", 53.55, -113.49, 200),
    ("Winnipeg", 49.90, -97.14, 250), ("Halifax", 44.65, -63.58, 250),
    # México, Centroamérica y Caribe
    ("Ciudad de México", 19.43, -99.13, 150), ("Guadalajara", 20.67, -103.35, 150), ("Monterrey", 25.67, -100.31, 150),
    ("Querétaro", 20.59, -100.39, 150), ("Puebla", 19.04, -98.20, 150), ("Mérida", 20.97, -89.62, 250),
    ("Tijuana", 32.51, -117.04, 150), ("Guatemala", 14.63, -90.51, 250), ("San Salvador", 13.69, -89.19, 200),
    ("Tegucigalpa", 14.07, -87.19, 250), ("San José CR", 9.93, -84.08, 250), ("Ciudad de Panamá", 8.98, -79.52, 250),
    ("Santo Domingo", 18.48, -69.93, 250), ("San Juan", 18.47, -66.11, 150), ("La Habana", 23.11, -82.37, 250),
    ("Kingston", 18.00, -76.79, 200), ("Puerto España", 10.65, -61.52, 200),
    # Sudamérica
    ("Bogotá", 4.65, -74.10, 150), ("Medellín", 6.25, -75.57, 150), ("Cali", 3.45, -76.53, 150),
    ("Barranquilla", 10.96, -74.80, 200), ("Bucaramanga", 7.12, -73.12, 200), ("Caracas", 10.48, -66.86, 300),
    ("Quito", -0.22, -78.51, 200), ("Guayaquil", -2.17, -79.92, 200), ("Lima", -12.05, -77.04, 250),
    ("La Paz", -16.50, -68.15, 250), ("Santa Cruz BO", -17.78, -63.18, 250), ("Santiago", -33.45, -70.67, 200),
    ("Buenos Aires", -34.61, -58.38, 200), ("Córdoba AR", -31.42, -64.18, 250), ("Montevideo", -34.90, -56.19, 250),
    ("Asunción", -25.28, -57.63, 250), ("São Paulo", -23.55, -46.63, 150), ("Rio de Janeiro", -22.91, -43.17, 150),
    ("Belo Horizonte", -19.92, -43.94, 200), ("Brasília", -15.78, -47.93, 200), ("Curitiba", -25.43, -49.27, 200),
    ("Porto Alegre", -30.03, -51.23, 200), ("Salvador", -12.97, -38.50, 250), ("Recife", -8.05, -34.88, 250),
    ("Fortaleza", -3.73, -38.52, 250), ("Manaus", -3.12, -60.02, 300), ("Goiânia", -16.68, -49.25, 250),
    # Europa
    ("London", 51.51, -0.13, 100), ("Manchester", 53.48, -2.24, 150), ("Birmingham", 52.49, -1.89, 150),
    ("Edinburgh", 55.95, -3.19, 200), ("Dublin", 53.35, -6.26, 200), ("Paris", 48.86, 2.35, 120),
    ("Lyon", 45.76, 4.84, 200), ("Toulouse", 43.60, 1.44, 250), ("Berlin", 52.52, 13.40, 150),
    ("Hamburg", 53.55, 9.99, 150), ("Munich", 48.14, 11.58, 150), ("Frankfurt", 50.11, 8.68, 150),
    ("Cologne", 50.94, 6.96, 150), ("Stuttgart", 48.78, 9.18, 150), ("Madrid", 40.42, -3.70, 150),
    ("Barcelona", 41.39, 2.17, 150), ("Valencia", 39.47, -0.38, 200), ("Sevilla", 37.39, -5.98, 250),
    ("Lisbon", 38.72, -9.14, 200), ("Porto", 41.15, -8.61, 150), ("Rome", 41.90, 12.50, 200),
    ("Milan", 45.46, 9.19, 200), ("Naples", 40.85, 14.27, 200), ("Amsterdam", 52.37, 4.90, 120),
    ("Brussels", 50.85, 4.35, 150), ("Luxembourg", 49.61, 6.13, 100), ("Zurich", 47.38, 8.54, 150),
    ("Geneva", 46.20, 6.14, 120), ("Vienna", 48.21, 16.37, 200), ("Stockholm", 59.33, 18.07, 250),
    ("Gothenburg", 57.71, 11.97, 200), ("Oslo", 59.91, 10.75, 250), ("Copenhagen", 55.68, 12.57, 200),
    ("Helsinki", 60.17, 24.94, 250), ("Reykjavik", 64.15, -21.94, 250), ("Warsaw", 52.23, 21.01, 250),
    ("Kraków", 50.06, 19.94, 200), ("Prague", 50.08, 14.44, 200), ("Bratislava", 48.15, 17.11, 150),
    ("Budapest", 47.50, 19.04, 250), ("Bucharest", 44.43, 26.10, 250), ("Cluj", 46.77, 23.59, 200),
    ("Sofia", 42.70, 23.32, 250), ("Athens", 37.98, 23.73, 250), ("Zagreb", 45.81, 15.98, 250),
    ("Belgrade", 44.79, 20.45, 250), ("Ljubljana", 46.06, 14.51, 200), ("Kyiv", 50.45, 30.52, 300),
    ("Vilnius", 54.69, 25.28, 250), ("Riga", 56.95, 24.11, 250), ("Tallinn", 59.44, 24.75, 250),
    ("Moscow", 55.76, 37.62, 300), ("Istanbul", 41.01, 28.98, 250), ("Ankara", 39.93, 32.86, 300),
    ("Tbilisi", 41.72, 44.79, 300), ("Yerevan", 40.18, 44.51, 250), ("Baku", 40.41, 49.87, 300),
    ("Nicosia", 35.19, 33.38, 200), ("Valletta", 35.90, 14.51, 100),
    # Medio Oriente y Asia Central
    ("Tel Aviv", 32.09, 34.78, 150), ("Amman", 31.95, 35.93, 250), ("Beirut", 33.89, 35.50, 200),
    ("Riyadh", 24.71, 46.68, 300), ("Jeddah", 21.49, 39.19, 300), ("Dubai", 25.20, 55.27, 250),
    ("Abu Dhabi", 24.45, 54.38, 200), ("Doha", 25.29, 51.53, 250), ("Kuwait City", 29.38, 47.99, 250),
    ("Manama", 26.23, 50.59, 150), ("Muscat", 23.59, 58.41, 300), ("Tehran", 35.69, 51.39, 300),
    ("Baghdad", 33.31, 44.37, 300), ("Almaty", 43.24, 76.89, 400), ("Tashkent", 41.30, 69.24, 400),
    # Sur de Asia
    ("Bengaluru", 12.97, 77.59, 100), ("Hyderabad", 17.39, 78.49, 150), ("Chennai", 13.08, 80.27, 150),
    ("Mumbai", 19.08, 72.88, 120), ("Pune", 18.52, 73.86, 120), ("Delhi", 28.61, 77.21, 150),
    ("Gurgaon-Noida", 28.46, 77.03, 80), ("Kolkata", 22.57, 88.36, 200), ("Ahmedabad", 23.02, 72.57, 250),
    ("Jaipur", 26.91, 75.79, 250), ("Kochi", 9.93, 76.27, 250), ("Coimbatore", 11.02, 76.96, 200),
    ("Lucknow", 26.85, 80.95, 300), ("Bhubaneswar", 20.30, 85.82, 300), ("Chandigarh", 30.73, 76.78, 250),
    ("Karachi", 24.86, 67.01, 250), ("Lahore", 31.55, 74.34, 250), ("Islamabad", 33.68, 73.05, 250),
    ("Dhaka", 23.81, 90.41, 250), ("Colombo", 6.93, 79.86, 250), ("Kathmandu", 27.72, 85.32, 250),
    # Este y Sudeste de Asia
    ("Tokyo", 35.68, 139.69, 120), ("Osaka", 34.69, 135.50, 150), ("Nagoya", 35.18, 136.91, 150),
    ("Fukuoka", 33.59, 130.40, 250), ("Sapporo", 43.06, 141.35, 300), ("Seoul", 37.57, 126.98, 150),
    ("Busan", 35.18, 129.08, 200), ("Beijing", 39.90, 116.40, 250), ("Shanghai", 31.23, 121.47, 250),
    ("Shenzhen", 22.54, 114.06, 200), ("Guangzhou", 23.13, 113.26, 200), ("Chengdu", 30.57, 104.07, 300),
    ("Hong Kong", 22.32, 114.17, 100), ("Taipei", 25.03, 121.57, 150), ("Kaohsiung", 22.63, 120.30, 200),
    ("Ulaanbaatar", 47.89, 106.91, 300), ("Singapore", 1.35, 103.82, 80), ("Kuala Lumpur", 3.14, 101.69, 200),
    ("Penang", 5.41, 100.33, 150), ("Bangkok", 13.76, 100.50, 250), ("Chiang Mai", 18.79, 98.98, 300),
    ("Ho Chi Minh", 10.82, 106.63, 250), ("Hanoi", 21.03, 105.85, 250), ("Da Nang", 16.05, 108.20, 250),
    ("Jakarta", -6.21, 106.85, 200), ("Surabaya", -7.25, 112.75, 250), ("Bali", -8.65, 115.22, 250),
    ("Manila", 14.60, 120.98, 250), ("Cebu", 10.32, 123.89, 250), ("Phnom Penh", 11.56, 104.92, 300),
    ("Yangon", 16.87, 96.20, 300), ("Vientiane", 17.97, 102.63, 300),
    # Oceanía
    ("Sydney", -33.87, 151.21, 150), ("Melbourne", -37.81, 144.96, 150), ("Brisbane", -27.47, 153.03, 200),
    ("Perth", -31.95, 115.86, 250), ("Adelaide", -34.93, 138.60, 250), ("Canberra", -35.28, 149.13, 200),
    ("Auckland", -36.85, 174.76, 250), ("Wellington", -41.29, 174.78, 250), ("Suva", -18.14, 178.44, 300),
    ("Port Moresby", -9.44, 147.18, 300),
    # África
    ("Cairo", 30.04, 31.24, 250), ("Casablanca", 33.57, -7.59, 300), ("Algiers", 36.75, 3.06, 300),
    ("Tunis", 36.81, 10.18, 250), ("Lagos", 6.52, 3.38, 250), ("Abuja", 9.08, 7.40, 300),
    ("Accra", 5.60, -0.19, 300), ("Abidjan", 5.36, -4.01, 300), ("Dakar", 14.72, -17.47, 300),
    ("Nairobi", -1.29, 36.82, 300), ("Kampala", 0.35, 32.58, 300), ("Dar es Salaam", -6.79, 39.21, 300),
    ("Kigali", -1.94, 30.06, 250), ("Addis Ababa", 9.03, 38.74, 300), ("Johannesburg", -26.20, 28.05, 250),
    ("Cape Town", -33.92, 18.42, 250), ("Durban", -29.86, 31.02, 250), ("Harare", -17.83, 31.05, 300),
    ("Lusaka", -15.39, 28.32, 300), ("Windhoek", -22.56, 17.08, 400), ("Gaborone", -24.65, 25.91, 300),
    ("Maputo", -25.97, 32.57, 300), ("Luanda", -8.84, 13.23, 300), ("Douala", 4.05, 9.77, 300),
    ("Kinshasa", -4.44, 15.27, 300), ("Antananarivo", -18.88, 47.51, 300), ("Port Louis", -20.16, 57.50, 150),
]

# Frases de búsqueda: el ranking de Meetup es difuso, varias frases mejoran el recall.
QUERIES = ["AWS", "AWS User Group", "AWS Cloud Club", "AWS Student Builder Group"]

Q_SEARCH = """query($q:String!,$lat:Float!,$lon:Float!,$r:Float!,$after:String){
  groupSearch(first:100,after:$after,filter:{query:$q,lat:$lat,lon:$lon,radius:$r}){
    pageInfo{hasNextPage endCursor}
    edges{node{id name urlname city country}}}}"""

Q_EVENTS = """query($u:String!,$s:EventStatus!,$after:String){
  groupByUrlname(urlname:$u){
    events(status:$s,first:50,after:$after){
      pageInfo{hasNextPage endCursor}
      edges{node{id title dateTime eventType rsvps{yesCount}}}}}}"""

# La API no pagina memberships con cursor, así que se pide todo en una consulta.
Q_MEMBERS = """query($u:String!){
  groupByUrlname(urlname:$u){
    memberships(first:20000){ totalCount edges{ metadata{ joinTime } } }}}"""

AWS_RE = re.compile(r'\baws\b|amazon web services')


def post(query, variables, timeout=40):
    body = json.dumps({"query": query, "variables": variables}).encode()
    for attempt in range(4):
        try:
            req = urllib.request.Request(GQL, data=body, headers=HEAD, method="POST")
            d = json.loads(urllib.request.urlopen(req, timeout=timeout, context=SSL_CTX).read())
            if "errors" in d:
                raise RuntimeError(str(d["errors"])[:200])
            return d["data"]
        except Exception:
            if attempt == 3:
                raise
            time.sleep(1.5 * (attempt + 1))


def is_aws(g):
    return bool(AWS_RE.search((g["name"] + " " + g["urlname"]).lower()))


def kind(g):
    s = (g["name"] + " " + g["urlname"]).lower()
    return "SBG" if re.search(r'sbg|student.builder|builder.group|student.*aws|aws.*student', s) else "UG"


def search_city(city):
    """Todas las búsquedas de una ciudad; devuelve lista de nodos que parecen grupos AWS."""
    name, lat, lon, r = city
    found = {}
    for q in QUERIES:
        after = None
        while True:
            d = post(Q_SEARCH, {"q": q, "lat": float(lat), "lon": float(lon),
                                "r": float(r), "after": after})
            s = d["groupSearch"]
            for e in s["edges"]:
                n = e["node"]
                if is_aws(n):
                    found[n["id"]] = n
            if s["pageInfo"]["hasNextPage"]:
                after = s["pageInfo"]["endCursor"]
            else:
                break
    return name, found


def discover_groups():
    found = {}
    done = 0
    with ThreadPoolExecutor(max_workers=WORKERS) as ex:
        futs = {ex.submit(search_city, c): c for c in CITIES}
        for fut in as_completed(futs):
            c = futs[fut]
            done += 1
            try:
                name, res = fut.result()
            except Exception as e:
                print(f"   ⚠ búsqueda fallida en {c[0]}: {e}")
                continue
            new = sum(1 for k in res if k not in found)
            found.update(res)
            print(f"   [{done}/{len(CITIES)}] {name:<18} {len(res):>3} grupos AWS ({new} nuevos) · acumulado {len(found)}")
    return found


def load_latam_known():
    """Grupos ya descubiertos por el proyecto LATAM (mismo formato de nodo)."""
    try:
        with open(LATAM_JSON, encoding="utf-8") as f:
            d = json.load(f)
    except Exception:
        return {}
    out = {}
    for g in d.get("grupos", []):
        out[g["id"]] = {"id": g["id"], "name": g["nombre"], "urlname": g["urlname"],
                        "city": g.get("ciudad", ""), "country": g.get("pais", "")}
    return out


def fetch_past_events(urlname):
    evs = []
    after = None
    while True:
        d = post(Q_EVENTS, {"u": urlname, "s": "PAST", "after": after})
        g = d.get("groupByUrlname")
        if not g:
            return []
        conn = g["events"]
        evs.extend(e["node"] for e in conn["edges"])
        if conn["pageInfo"]["hasNextPage"]:
            after = conn["pageInfo"]["endCursor"]
        else:
            break
    return evs


def fetch_members(urlname):
    """(miembros_totales, miembros_nuevos_YEAR, truncado)"""
    try:
        d = post(Q_MEMBERS, {"u": urlname}, timeout=90)
        g = d.get("groupByUrlname")
        if g and g.get("memberships"):
            m = g["memberships"]
            total = m["totalCount"] or 0
            edges = m.get("edges") or []
            nuevos = sum(1 for e in edges
                         if ((e.get("metadata") or {}).get("joinTime") or "")[:4] == str(YEAR))
            return total, nuevos, len(edges) < total
    except Exception:
        pass
    return 0, 0, False


def process_group(g):
    urlname = g["urlname"]
    country = (g.get("country") or "??").lower()
    base = {
        "id": g["id"], "nombre": g["name"], "urlname": urlname,
        "ciudad": g.get("city", ""), "pais": country,
        "pais_nombre": COUNTRIES.get(country, country.upper()),
        "tipo": kind(g),
    }
    try:
        evs = fetch_past_events(urlname)
        total, nuevos, trunc = fetch_members(urlname)
    except Exception as e:
        return {**base, "meetups_2026": 0, "alcance_2026": 0, "miembros": 0,
                "miembros_total": 0, "error": str(e)[:120]}, [], False
    evs_y = [e for e in evs if (e.get("dateTime") or "")[:4] == str(YEAR)]
    alcance = sum((e.get("rsvps") or {}).get("yesCount", 0) or 0 for e in evs_y)
    row = {**base, "meetups_2026": len(evs_y), "alcance_2026": alcance,
           "miembros": nuevos, "miembros_total": total}
    event_rows = [{
        "pais": country, "tipo_grupo": base["tipo"], "grupo": g["name"],
        "ciudad": g.get("city", ""), "fecha": ev["dateTime"][:10], "titulo": ev["title"],
        "tipo_evento": ev.get("eventType", ""),
        "asistentes": (ev.get("rsvps") or {}).get("yesCount", 0),
        "url": f"https://www.meetup.com/{urlname}/events/{ev['id']}/",
    } for ev in sorted(evs_y, key=lambda e: e["dateTime"])]
    return row, event_rows, trunc


def run():
    os.makedirs(OUT, exist_ok=True)

    print(f"🔍 Descubriendo grupos AWS en el mundo ({len(CITIES)} ciudades × {len(QUERIES)} búsquedas)...")
    groups = discover_groups()
    known = load_latam_known()
    added = {k: v for k, v in known.items() if k not in groups}
    groups.update(added)
    print(f"   → {len(groups)} grupos únicos ({len(added)} añadidos desde el proyecto LATAM)\n")

    rows, event_rows, truncated = [], [], []
    total = len(groups)
    with ThreadPoolExecutor(max_workers=WORKERS) as ex:
        futs = {ex.submit(process_group, g): g for g in groups.values()}
        for i, fut in enumerate(as_completed(futs), 1):
            g = futs[fut]
            row, evs, trunc = fut.result()
            rows.append(row)
            event_rows.extend(evs)
            if trunc:
                truncated.append(g["name"])
            flag = " ⚠ ERROR " + row["error"] if row.get("error") else ""
            print(f"[{i}/{total}] [{row['tipo']}][{row['pais'].upper()}] {g['name'][:48]:<48} "
                  f"{row['meetups_2026']:>3}m · {row['alcance_2026']:>5}a · nuevos {row['miembros']:>5}{flag}")

    if truncated:
        print(f"\n⚠ Membresías truncadas (nuevos subestimado) en: {', '.join(truncated)}")

    event_rows.sort(key=lambda e: (e["pais"], e["grupo"], e["fecha"]))
    ranking = sorted(rows, key=lambda r: (r["meetups_2026"], r["alcance_2026"]), reverse=True)

    def totals(pred):
        gs = [r for r in rows if pred(r)]
        return {
            "grupos": len(gs),
            "activos": sum(1 for r in gs if r["meetups_2026"] > 0),
            "meetups": sum(r["meetups_2026"] for r in gs),
            "alcance": sum(r["alcance_2026"] for r in gs),
            "miembros": sum(r["miembros"] for r in gs),
            "miembros_total": sum(r["miembros_total"] for r in gs),
        }

    paises = sorted(set(r["pais"] for r in rows))
    totales = {"ALL": totals(lambda r: True)}
    for p in paises:
        totales[p] = totals(lambda r, _p=p: r["pais"] == _p)

    payload = {
        "year": YEAR,
        "generado": datetime.now().isoformat(),
        "paises": {p: COUNTRIES.get(p, p.upper()) for p in paises},
        "totales": totales,
        "grupos": ranking,
    }

    with open(os.path.join(OUT, "global_grupos_2026.json"), "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    with open(os.path.join(OUT, "global_eventos_2026.csv"), "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["pais", "tipo_grupo", "grupo", "ciudad", "fecha",
                                          "titulo", "tipo_evento", "asistentes", "url"])
        w.writeheader()
        w.writerows(event_rows)

    render_html(payload, event_rows)

    t = totales["ALL"]
    print(f"\n{'=' * 78}")
    print(f" GLOBAL {YEAR}: {t['grupos']} grupos · {t['activos']} activos · {t['meetups']} meetups · "
          f"alcance {t['alcance']} · miembros nuevos {t['miembros']}")
    print(f"{'=' * 78}")
    print(f"{'País':<22} {'Grupos':>7} {'Activos':>8} {'Meetups':>8} {'Alcance':>8} {'Nuevos':>8}")
    print("-" * 78)
    for p in sorted(paises, key=lambda p: -totales[p]["meetups"])[:30]:
        tt = totales[p]
        if tt["meetups"] == 0:
            continue
        print(f"  {COUNTRIES.get(p, p.upper()):<20} {tt['grupos']:>7} {tt['activos']:>8} "
              f"{tt['meetups']:>8} {tt['alcance']:>8} {tt['miembros']:>8}")
    print(f"{'=' * 78}")
    print(f"\nArchivos en {OUT}/  +  index.html")


def render_html(payload, events):
    with open(os.path.join(HERE, "template.html"), encoding="utf-8") as f:
        tpl = f.read()
    evs_web = [{
        "pais": e["pais"], "grupo": e["grupo"], "ciudad": e["ciudad"],
        "tipoGrupo": e["tipo_grupo"], "fecha": e["fecha"],
        "titulo": e["titulo"], "tipo": e["tipo_evento"],
        "asistentes": e["asistentes"], "url": e["url"],
    } for e in events]
    html = tpl.replace("/*__DATA__*/null", json.dumps(payload, ensure_ascii=False))
    html = html.replace("/*__EVENTS__*/null", json.dumps(evs_web, ensure_ascii=False))
    with open(os.path.join(HERE, "index.html"), "w", encoding="utf-8") as f:
        f.write(html)
    print(f"   → index.html generado ({len(html):,} bytes)")


if __name__ == "__main__":
    run()
