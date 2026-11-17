# AWS Community Global

Estadísticas 2026 de los grupos de la comunidad AWS (Student Builder Groups y User Groups) en todo el mundo:
grupos, meetups realizados, alcance (RSVP confirmados) y miembros nuevos del año, con filtros por tipo, continente y país.

Sitio: https://awscommunity.live/

> Proyecto comunitario independiente. No está afiliado, respaldado ni patrocinado por Amazon Web Services.
> AWS y los nombres relacionados son marcas de Amazon.com, Inc. o sus afiliadas.

## Cómo funciona

- `scrape_global.py` descubre grupos con "AWS" en el nombre usando la API GraphQL pública de Meetup (sin login),
  descarga sus eventos pasados de 2026, el total de miembros y los miembros con fecha de ingreso en 2026.
- Genera `output/global_grupos_2026.json`, `output/global_eventos_2026.csv` y `index.html` (versión anterior, a partir de `template.html`).
- La cobertura es de mejor esfuerzo: la búsqueda de Meetup devuelve máximo 200 resultados por consulta,
  así que se consulta desde ~260 ciudades con varias frases. Puede faltar algún grupo.

## Uso

```bash
python3 scrape_global.py   # ~8 minutos; solo usa la librería estándar (certifi es opcional)
python3 -m http.server 8000   # ver en http://localhost:8000
```

Opcionalmente, si existe `../meetups-latam/output/latam_grupos_2026.json`, se unen esos grupos a los descubiertos.

## Web

La interfaz está en `web/` (Vite + React): globo 3D, filtros, estadísticas y explorador de grupos. Ver `web/README.md`.

```bash
python3 web/scripts/prepare_data.py   # datos de output/ → web/public/data/
cd web && npm install && npm run dev  # http://localhost:5173
```

## Despliegue (S3 + CloudFront)

Automático con GitHub Actions al hacer merge a `main` y cada día con datos nuevos. Configuración única: `docs/DESPLIEGUE.md`.

Manual:

```bash
cp .deploy.env.example .deploy.env   # completar con tu perfil, bucket y distribución
./deploy.sh                          # compila web/ y publica web/dist
```

## Notas sobre los datos

- Alcance = suma de RSVP "yes" de eventos PAST de 2026, no asistencia física verificada.
- Miembros nuevos = membresías actuales con `joinTime` en 2026 (quien se unió y luego salió no se cuenta).
- Los datos son públicos de Meetup y se muestran agregados por grupo.
