#!/usr/bin/env bash
# Publica index.html en S3 e invalida la caché de CloudFront.
# Uso: ./deploy.sh   (después de correr python3 scrape_global.py)
# Configuración: copia .deploy.env.example a .deploy.env y completa los valores.
set -euo pipefail
cd "$(dirname "$0")"
[ -f .deploy.env ] || { echo "Falta .deploy.env (ver .deploy.env.example)"; exit 1; }
set -a; . ./.deploy.env; set +a
export AWS_PROFILE
aws s3 cp index.html "s3://$BUCKET/index.html" \
  --content-type "text/html; charset=utf-8" --cache-control "public, max-age=300"
aws cloudfront create-invalidation --distribution-id "$DIST_ID" --paths "/index.html" \
  --query 'Invalidation.Id' --output text
echo "Listo: $SITE_URL"
