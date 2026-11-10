# Runbook — DocuSign a la cuenta de producción

**Fecha:** 2026-11-10 · **Estado:** vigente, **no ejecutado** (Production sigue en la cuenta
Demo de Nexxos: `account-d.docusign.com`, `https://demo.docusign.net`).

Cómo pasar Production de la cuenta Demo a la cuenta de producción de DocuSign. Requiere el PR
`feat/docusign-event-notification` mergeado y desplegado **antes** del paso 6.

---

## 0 · Qué cambia con el PR

- **Eventos por sobre, no por cuenta.** En Production, cada sobre que crea
  `/api/agreement/create` lleva su propio `eventNotification`
  (`src/lib/docusign-event-notification.ts`). No hace falta configurar Connect en la cuenta,
  y funciona en cualquier plan de API:
  - URL `${NEXT_PUBLIC_SITE_URL}/api/webhooks/docusign` (Production: `https://lixtara.com`).
  - SIM, REST v2.1 en JSON, `requireAcknowledgment`, `includeHMAC`, `loggingEnabled`.
  - Eventos: `envelope-sent`, `envelope-delivered`, `envelope-completed`, `envelope-declined`,
    `envelope-voided`, `recipient-completed`.
- **Preview y Development no lo ponen:** siguen con el Connect de la cuenta Demo. Preview
  comparte la base con Production.
- **Autenticación del webhook** (`src/lib/docusign-connect.ts`): se acepta **HMAC válido o
  token válido**.
  - HMAC: `DOCUSIGN_CONNECT_HMAC_KEY` (y `_KEY_2` para rotar), igual que antes.
  - Token, el respaldo si la cuenta de producción no permite claves HMAC:
    `DOCUSIGN_WEBHOOK_TOKEN`, de al menos 32 caracteres. Con el token configurado viaja en la
    URL del sobre (`?token=…`) y se compara en tiempo constante.
  - Con algo configurado y nada válido: 401. Sin nada configurado, en Production: 401.
  - El receptor sigue sin confiar en el payload: cada evento solo dispara `refreshAgreement`,
    que lee el sobre en DocuSign.
  - En Production, una entrega aceptada con `docusign_events.hmac_valid = false` entró por
    token.
- **Consentimiento JWT:** el error `consent_required` ya no apunta a
  `lixtara.vercel.app/api/agreement/consent-callback` (una ruta que no existe). Ahora arma la
  URL con `DOCUSIGN_AUTH_HOST` y `DOCUSIGN_CONSENT_REDIRECT_URI`; si esta última falta, dice qué
  configurar.

## 1 · Variables de Production

| Variable | ¿Cambia? | Valor en producción |
|---|---|---|
| `DOCUSIGN_AUTH_HOST` | sí | `account.docusign.com` |
| `DOCUSIGN_BASE_URI` | sí | Account Base URI de la cuenta (p. ej. `https://naX.docusign.net`), **sin** `/restapi` |
| `DOCUSIGN_ACCOUNT_ID` | sí | API Account ID |
| `DOCUSIGN_USER_ID` | sí | GUID del usuario impersonado (el remitente que ven los vendedores) |
| `DOCUSIGN_INTEGRATION_KEY` | no | mismo GUID (el Go-Live lo promueve) |
| `DOCUSIGN_PRIVATE_KEY` | sí | par RSA nuevo generado en la cuenta de prod |
| `DOCUSIGN_LISTING_AGREEMENT_TEMPLATE_ID` | sí | id de la v4 importada en prod |
| `DOCUSIGN_CONNECT_HMAC_KEY` | sí | clave HMAC de la cuenta de prod (si la permite) |
| `DOCUSIGN_WEBHOOK_TOKEN` | **nueva**, opcional | solo si no hay HMAC: `openssl rand -hex 32` |
| `DOCUSIGN_CONSENT_REDIRECT_URI` | **nueva**, opcional | un Redirect URI registrado en la integración, p. ej. `https://lixtara.com/` |
| `DOCUSIGN_AS_IS_…`, `…_COMMISSION_…`, `…_COMPENSATION_…` | opcional | solo los usan `scripts/docusign/*` |

**Preview y Development se quedan en Demo.**

## 2 · Go-Live del integration key

1. En la cuenta de desarrollo: Apps & Keys → la integración → **Start Go-Live Review**.
   Requiere unas 20 llamadas exitosas en los últimos 30 días.
2. Cuando pase: **Select account** → entra con un admin de la cuenta de producción para promover
   la integración.

## 3 · Cuenta de producción: Apps & Keys

1. La integración (mismo integration key) → **Generate RSA**. La clave privada va a
   `DOCUSIGN_PRIVATE_KEY`; los pares de Demo no pasan a producción.
2. **Redirect URI:** añade `https://lixtara.com/`, el mismo valor que irá en
   `DOCUSIGN_CONSENT_REDIRECT_URI`.
3. Anota el API Account ID, el Account Base URI y el User ID del usuario que enviará los
   sobres. Usa un usuario con nombre de Lixtara o de la broker: es el remitente que ven los
   vendedores ("X via DocuSign").

## 4 · Consentimiento JWT (una vez)

El usuario del paso 3.3, con su sesión de la cuenta de producción, abre:

```
https://account.docusign.com/oauth/auth?response_type=code&scope=signature%20impersonation&client_id=<INTEGRATION_KEY>&redirect_uri=https%3A%2F%2Flixtara.com%2F
```

y acepta. Que después caiga en la home no importa: el consentimiento ya quedó guardado. Si se
salta este paso, la creación del sobre devuelve `docusign_failed` y en el `detail` aparece esta
misma URL (`consentRequiredMessage`).

## 5 · Plantilla v4 y clave HMAC

**Plantilla.** La v4 de Demo (`3c9363c5…`, "Lixtara - Listing Agreement (ERS-21tn) v4") **no se
toca** (memoria `docusign_template_rule`).

1. Demo → Templates → v4 → ⋯ → **Download** (JSON: PDF, roles y tabs).
2. Producción → Templates → New → **Upload template** → ese JSON. Compártela con el usuario
   impersonado si no es suyo.
3. Los **nombres de rol tienen que ser idénticos** (vendedor `Seller`, segundo vendedor, broker
   `Broker`), y los `tabLabel` también.
4. Verifica en solo lectura con las credenciales de prod en la línea de comando. El cargador de
   `.env.local` no pisa las variables que ya existen, así que `.env.local` no se toca:
   ```
   DOCUSIGN_AUTH_HOST=account.docusign.com DOCUSIGN_BASE_URI=… DOCUSIGN_ACCOUNT_ID=… \
   DOCUSIGN_USER_ID=… DOCUSIGN_PRIVATE_KEY="…" DOCUSIGN_LISTING_AGREEMENT_TEMPLATE_ID=<nuevo> \
   pnpm tsx scripts/check-docusign-template.ts
   ```

**Clave HMAC.** Producción → Settings → Connect → **Connect Keys** → Add secret key. El valor va
a `DOCUSIGN_CONNECT_HMAC_KEY`.

- No hace falta crear una configuración de Connect: el `includeHMAC` de cada sobre firma con
  estas claves.
- **Si el plan no permite crear la clave:** genera `DOCUSIGN_WEBHOOK_TOKEN`
  (`openssl rand -hex 32`) y no pongas `DOCUSIGN_CONNECT_HMAC_KEY` de producción.
- **No crees además una configuración de Connect a nivel de cuenta** apuntando a lixtara.com:
  cada evento llegaría dos veces. Es inofensivo (`refresh` es idempotente), pero ensucia
  `docusign_events`.

## 6 · Corte en Vercel (solo Production)

1. Anota el deploy actual de Production: es el punto de vuelta.
2. Carga las variables marcadas "sí" en el §1, más `DOCUSIGN_CONSENT_REDIRECT_URI` y, si aplica,
   `DOCUSIGN_WEBHOOK_TOKEN`.
   - Para el HMAC, durante el corte pon la clave de prod en `DOCUSIGN_CONNECT_HMAC_KEY_2` y deja
     la de Demo en `_KEY`: se aceptan entregas de las dos cuentas.
   - Al terminar, mueve la de prod a `_KEY` y borra `_2`.
3. **Redeploy obligatorio:** las variables solo aplican a deploys nuevos.
4. Comprobación sin sobre: `curl -s -X POST https://lixtara.com/api/webhooks/docusign` debe
   devolver `401 invalid_signature`.

## 7 · Prueba

1. Usa un listing `is_test` en Production con **tu correo** como vendedor. Crea el acuerdo
   (paso 7), fírmalo, y que la broker contrafirme.
2. Verifica (solo lectura):
   ```sql
   select a.envelope_id, a.status, a.updated_at
     from public.agreements a
    where a.property_id = '<listing is_test>'
    order by a.created_at desc limit 1;

   select event_type, hmac_valid, duplicate, resulting_status, note
     from public.docusign_events
    where envelope_id = '<envelope_id de arriba>'
    order by 1;
   ```
   Lo esperado:
   - Eventos `envelope-sent`, `recipient-completed` y `envelope-completed`, sin nota.
   - `hmac_valid = true` (o `false` solo si usas el token).
   - El acuerdo pasa por `signed` → `completed`.
   - La revisión del admin reconoce la contrafirma. La aprobación se bloquea igual por
     `is_test`, con ese motivo.
3. En DocuSign (prod) → el sobre → **Envelope history / Connect logs**: entregas con 200.
4. Si no quieres un acuerdo completado de verdad, **declínalo** en lugar de firmarlo: así se
   prueba `envelope-declined`. Ojo: en producción es un documento real y cuenta para el cupo de
   sobres.

## 8 · Vuelta atrás

- Instant Rollback al deploy anotado en el paso 6.1, o las variables de Demo más un redeploy.
- Los sobres enviados en prod en el intermedio no se pueden leer desde Demo: sus acuerdos quedan
  congelados (`refresh` devuelve `fetched = false`) hasta volver a prod.

## 9 · Datos que ya existen

Hay 14 acuerdos con sobres de Demo (8 `signed`, 1 `completed`, 5 `voided`, al 2026-11-09),
**todos en listings `is_test`**. Con producción, `refresh` no los encuentra (404) y la
aprobación se bloquea, como debe. No afecta a vendedores reales; se limpian con los datos de
prueba.
