#!/usr/bin/env bash
# Compila la web (web/) y la publica en S3 + invalida la caché de CloudFront.
#
# Local:   cp .deploy.env.example .deploy.env  (completar)  y  ./deploy.sh
# GitHub:  .github/workflows/deploy.yml lo ejecuta solo al hacer merge a main,
#          con BUCKET y DIST_ID en el entorno (ver docs/DESPLIEGUE.md).
set -euo pipefail
cd "$(dirname "$0")"

if [ -f .deploy.env ]; then set -a; . ./.deploy.env; set +a; fi
: "${BUCKET:?Falta BUCKET (ver .deploy.env.example)}"
: "${DIST_ID:?Falta DIST_ID (ver .deploy.env.example)}"
if [ -n "${AWS_PROFILE:-}" ]; then export AWS_PROFILE; fi

echo "→ Instalando dependencias y preparando datos"
(cd web && npm ci --no-audit --no-fund)
python3 web/scripts/prepare_data.py

echo "→ Compilando"
(cd web && npm run build)

DIST=web/dist
echo "→ Subiendo a s3://$BUCKET"
# JS/CSS con hash en el nombre: caché de un año
aws s3 sync "$DIST/assets" "s3://$BUCKET/assets" --cache-control "public, max-age=31536000, immutable"
# Datos: cambian con cada actualización de Meetup
aws s3 sync "$DIST/data" "s3://$BUCKET/data" --cache-control "public, max-age=300"
# Texturas, banderas, favicon
aws s3 sync "$DIST" "s3://$BUCKET" --exclude "assets/*" --exclude "data/*" --exclude "index.html" \
  --cache-control "public, max-age=86400"
# La página va al final, cuando todo lo que referencia ya está arriba
aws s3 cp "$DIST/index.html" "s3://$BUCKET/index.html" \
  --content-type "text/html; charset=utf-8" --cache-control "public, max-age=300"

echo "→ Invalidando CloudFront"
aws cloudfront create-invalidation --distribution-id "$DIST_ID" --paths "/*" \
  --query 'Invalidation.Id' --output text

echo "Listo: ${SITE_URL:-https://awscommunity.live/}"
