# AWS Community Global · web

Nueva interfaz de awscommunity.live: globo 3D con los grupos de la comunidad AWS (Student Builder Groups y User Groups),
filtros por tipo, región y país, estadísticas del año y explorador de grupos. EN / ES / PT.

Vite + React + TypeScript + Tailwind 4 + shadcn. El globo usa three.js / react-three-fiber.

## Desarrollo

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # genera dist/
npm run preview    # sirve dist/ en http://localhost:4173
```

## Datos

La web lee `public/data/groups.json` y `public/data/events.json`. Se generan desde la salida del scraper:

```bash
cd ..
python3 scrape_global.py           # actualiza output/
python3 web/scripts/prepare_data.py
```

`prepare_data.py` agrega coordenadas a cada grupo (ciudad conocida o, si no, centro del país) y copia las banderas
SVG de los países presentes (`country-flag-icons`, MIT) a `public/flags/`.

## Créditos

- Globo basado en el componente Globe3D de 21st.dev, adaptado (puntos agrupados por zoom, foco animado).
- Texturas de la Tierra: NASA Blue Marble (vía three-globe).
- El bento de estadísticas toma la idea de layout de "Analytics Bento" (@romanvasnev, MIT); implementación propia.
