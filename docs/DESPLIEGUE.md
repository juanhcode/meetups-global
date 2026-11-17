# Despliegue automático

Después de esta configuración (se hace **una sola vez**), el sitio se publica solo:

- **al hacer merge a `main`** (por ejemplo, al aceptar un PR),
- **cada día a las 06:00 (Colombia)** con datos nuevos de Meetup,
- **a mano** desde *Actions → Desplegar sitio → Run workflow*.

GitHub entra a AWS con **OIDC**: no se guardan claves de acceso en el repo. El rol solo lo puede usar la rama `main`
de `juanhcode/meetups-global`, y solo puede subir archivos al bucket e invalidar la caché de CloudFront.

Mientras no esté configurado, el workflow se salta el despliegue con un aviso y no falla.

## 1. Datos que necesitas

Reemplaza en los comandos de abajo:

| Valor | Ejemplo | Dónde verlo |
|---|---|---|
| `ACCOUNT_ID` | `123456789012` | `aws sts get-caller-identity` |
| `BUCKET` | `awscommunity-live` | el mismo de tu `.deploy.env` |
| `DIST_ID` | `E1ABCDEF2GHIJK` | el mismo de tu `.deploy.env` |

## 2. Proveedor OIDC de GitHub (una vez por cuenta de AWS)

Si ya existe en la cuenta, sáltate este paso.

```bash
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com
```

## 3. Rol para el despliegue

`trust.json`: solo la rama `main` de este repo puede asumir el rol.

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Federated": "arn:aws:iam::ACCOUNT_ID:oidc-provider/token.actions.githubusercontent.com" },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": {
        "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
        "token.actions.githubusercontent.com:sub": "repo:juanhcode/meetups-global:ref:refs/heads/main"
      }
    }
  }]
}
```

`permisos.json`: subir archivos al bucket e invalidar la distribución. No permite borrar nada.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Sid": "ListarBucket", "Effect": "Allow", "Action": "s3:ListBucket", "Resource": "arn:aws:s3:::BUCKET" },
    { "Sid": "SubirArchivos", "Effect": "Allow", "Action": "s3:PutObject", "Resource": "arn:aws:s3:::BUCKET/*" },
    { "Sid": "InvalidarCache", "Effect": "Allow", "Action": "cloudfront:CreateInvalidation",
      "Resource": "arn:aws:cloudfront::ACCOUNT_ID:distribution/DIST_ID" }
  ]
}
```

```bash
aws iam create-role --role-name github-meetups-global-deploy \
  --assume-role-policy-document file://trust.json
aws iam put-role-policy --role-name github-meetups-global-deploy \
  --policy-name deploy-sitio --policy-document file://permisos.json
```

Si el bucket cifra con una clave KMS propia (SSE-KMS), agrega `kms:GenerateDataKey` sobre esa clave.

## 4. Variables del repo en GitHub

No son secretos (no dan acceso por sí solas), por eso van como *variables*:

```bash
gh variable set AWS_ROLE_ARN --repo juanhcode/meetups-global \
  --body "arn:aws:iam::ACCOUNT_ID:role/github-meetups-global-deploy"
gh variable set S3_BUCKET --repo juanhcode/meetups-global --body "BUCKET"
gh variable set CLOUDFRONT_DISTRIBUTION_ID --repo juanhcode/meetups-global --body "DIST_ID"
gh variable set SITE_URL --repo juanhcode/meetups-global --body "https://awscommunity.live/"
# Opcional, si el bucket no está en us-east-1:
gh variable set AWS_REGION --repo juanhcode/meetups-global --body "us-east-1"
```

O en GitHub: *Settings → Secrets and variables → Actions → Variables*.

## 5. Probar

*Actions → Desplegar sitio → Run workflow*. En unos minutos el sitio queda actualizado.

## Despliegue manual (sigue funcionando)

```bash
cp .deploy.env.example .deploy.env   # completar
./deploy.sh
```
