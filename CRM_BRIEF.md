# Lixtara CRM en Supabase — brief para Claude Code

Contexto: el CRM de prospección se opera **desde el admin de Lixtara**, con Supabase como única base de datos. Attio queda descartado. El envío de email en frío lo hace Instantly (u otro sender equivalente). La base de propietarios sale de `lixtara_base.py`, que se corre fuera del repo en `~/lixtara-data/`.

## Archivos de este paquete

| Archivo | Va en el repo en | Qué hace |
|---|---|---|
| `supabase/migrations/20261012120000_crm_leads.sql` | `supabase/migrations/` | Crea las tablas `crm_*`, los triggers de supresión, la vista de enviables y RLS solo para staff (admin o broker) |
| `outreach-webhook/logic.ts` | `src/lib/crm/outreach-webhook-logic.ts` | Lógica pura del webhook de Instantly. La recibe la ruta de Next `src/app/api/crm/outreach-webhook/route.ts` (no hay Edge Function; `index.ts` no se usa) |
| `scripts/import_crm_leads.py` | `scripts/` | Carga los CSV de `lixtara_base.py` con upsert. Lo corre Camilo en local |

Todo se probó en Postgres 16 con stubs de `auth`: migración idempotente, triggers, vista, RLS (admin ve, no-admin ve 0, anon sin permiso), importación y recarga sin duplicar ni pisar email/DNC. La lógica del webhook también está probada. **No se probó contra un proyecto Supabase real** ni con un webhook real de Instantly.

## Pasos de instalación

1. Revisar que ninguna tabla `crm_*` exista ya en el proyecto. La app ya tiene `properties`; por eso todo lleva prefijo `crm_`.
2. `supabase db push` con sign-off del owner (ver "Database migrations" en `CLAUDE.md`).
3. Acceso: no hay tabla de admins del CRM. Entra quien tenga rol `admin` o `broker` en `user_roles` (`is_crm_admin()` envuelve `is_admin_or_broker()`).
4. Webhook (ruta de Next en Vercel):
   - `vercel env add OUTREACH_WEBHOOK_TOKEN production` con un token largo aleatorio.
   - En Instantly, crear el webhook hacia `https://lixtara.com/api/crm/outreach-webhook` con el header `Authorization: Bearer <token>`. El token en la URL (`?token=`) queda solo como alternativa.
5. Importación (Camilo, en local):
   ```
   export SUPABASE_DB_URL="<connection string, modo Session>"
   python scripts/import_crm_leads.py --dir ~/lixtara-data/salida --dry-run
   python scripts/import_crm_leads.py --dir ~/lixtara-data/salida
   ```
6. Emails del skip tracing (Camilo, en local), después de la importación de propietarios.
   Requiere la migración `20261013235500_crm_contacts_evidence`. CSV con
   `owner_key,email,email_source,verification_status` (`valid|invalid|risky|unknown`) y la evidencia
   del pipeline local: `class` (A/B/C), `rule`, `rules_version`, `eligible`, `eligibility_basis`
   (opcionales: `evidence`, `ledger_ref`, `verification_method`, `validated_at`). Todo queda en
   `crm_contacts` con historial append-only; solo Clase A elegible + `valid` llega a `crm_owners.email`
   (enviable). Nunca se pisa ni se carga un email suprimido:
   ```
   python scripts/import_contacts.py --file ~/lixtara-data/contactos.csv --dry-run
   python scripts/import_contacts.py --file ~/lixtara-data/contactos.csv
   ```

## Pantallas del admin por construir (mínimo útil)

Todas server-side o con la sesión del admin. **Nunca** usar la service role key en el navegador.

1. **Propietarios** (`/admin/crm/owners`)
   - Tabla con filtros: prioridad, tipo, ZIP, grupo de piloto, estado de outreach, con o sin email.
   - Orden por score.
   - Columnas: nombre, tipo, número de propiedades, valor de cartera, prioridad, estado y último evento.
2. **Ficha del propietario**
   - Datos postales, propiedades vinculadas (folio, dirección, valor, señales) y decisor de Sunbiz.
   - Historial de `crm_outreach` con el texto de las respuestas.
   - Botón "Suprimir" (inserta en `crm_suppression` con `reason = 'manual'`).
3. **Campañas** (`/admin/crm/campaigns`)
   - Crear campaña: nombre, canal y filtros del segmento (se guardan en `crm_campaigns.segment`).
   - "Enviar segmento a Instantly":
     - Leer **solo** desde `crm_sendable_email_owners`, que ya excluye supresiones, rebotes, bajas y propietarios con listado activo en el MLS.
     - Guardar el snapshot en `crm_campaign_members`.
     - Llamar a la API de Instantly para agregar los leads a la campaña, enviando `owner_key` (el webhook la usa para identificar al propietario) y `property_address` (dirección y ciudad de la propiedad vigente de mayor score) como variables personalizadas.
     - **Verificar el endpoint exacto de "add leads to campaign" en developer.instantly.ai antes de implementarlo.** No está confirmado.
   - Métricas por campaña y por `pilot_group`: enviados, respuestas, interesados, bajas y rebotes. **Comparar Score vs Control** antes de escalar.
4. **Bandeja de respuestas**
   - Eventos `reply_received` y `lead_interested` sin gestionar.
   - Enlace a la ficha y botón para crear la consulta o el deal del listing de $495.

## Reglas que el código debe respetar

- Toda exportación o envío sale de `crm_sendable_email_owners`, nunca de `crm_owners` directo.
- La supresión es global y permanente: un email suprimido no se reactiva desde la UI.
- Teléfono y SMS: no hay flujo. `dnc_status` queda en "Pendiente" hasta que exista un scrub contra el DNC federal y el de Florida. Llamadas automatizadas y SMS requieren consentimiento escrito (TCPA/FTSA).
- Plantillas de email (en Instantly):
  - Nombre legal, dirección física y la línea de licencia, tal como salen de `src/config/brokerage.ts` (`BROKERAGE`, `brokerageLicenseLine(lang)`). Nunca se escriben a mano.
  - Enlace de baja.
  - EN y ES en el mismo email, sin elegir el idioma por apellido.
- Enviar desde dominios secundarios con calentamiento, nunca desde lixtara.com.
- Ningún mensaje presenta inferencias como hechos (por ejemplo, "perdió su propiedad por impuestos").

## Fuera de alcance de esta fase

- Script de reconciliación anual: ver `claude/lixtara-base-propietarios-decisiones.md` en el proyecto.
- Correo físico vía Lob/PostGrid: la tabla `crm_campaigns` ya admite `channel = 'postal'`.
