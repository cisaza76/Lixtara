# Runbook · Analítica: GA4 (vía GTM) + PostHog

**Estado:** código listo y apagado.
- Sin variables de entorno no se carga nada y queda el aviso de cookies de siempre.
- Activar = crear las cuentas + poner las variables en Vercel (Production) + redeploy, **con autorización del owner**.

**Decisión del owner (2026-10-11):**
- **GA4 = marketing y adquisición:** fuentes, campañas, SEO, Google Ads.
- **PostHog = producto:** embudos, abandono, cohortes, feature flags y, cuando haya volumen, experimentos.

## Reglas que el código ya aplica
| Regla | Dónde |
|---|---|
| Nada se carga sin consentimiento. "Aceptar" y "Rechazar" tienen el mismo peso visual | `src/components/analytics-consent.tsx` |
| Consent Mode v2: publicidad siempre denegada, solo `analytics_storage` concedido al aceptar | `loadGtm()` |
| Sin consentimiento, `track()` no hace nada ni encola eventos | `src/lib/analytics.ts` |
| Al rechazar o retirar el consentimiento ("Configurar cookies" en el pie) se borran `_ga*`, `ph_*` y el almacenamiento de PostHog | `clearAnalyticsStorage()` |
| PostHog **sin autocapture** (no lee textos, imágenes ni URLs de fichas del MLS), **sin grabación de sesión**, sin encuestas, `person_profiles: identified_only` | `loadPosthog()` |
| URLs **sin parámetros ni fragmento** en PostHog (`$current_url`, referrers) | `sanitizeUrl()` |
| Pageviews de PostHog manuales (uno por cambio de ruta). GA4 cuenta los suyos desde GTM: no hay duplicados dentro de una misma herramienta | `AnalyticsConsent` |
| Eventos comerciales desde el **servidor**, por cambio de estado verificable, con id interno y sin datos personales | `src/lib/analytics.server.ts` |
| La política de cookies cambia sola a la variante con analítica cuando hay variables configuradas | `cookiesDocFor()` |

## Catálogo de eventos

**Navegador** (solo con consentimiento → `dataLayer` para GTM + PostHog):

| Evento | Embudo | Propiedades |
|---|---|---|
| `listing_step_view` | Vendedor | `step`, `step_name`, `lang` |
| `email_verified` | Vendedor | `method`, `lang` |
| `property_search` | Comprador | `page`, `sort`, `has_price`, `has_beds`, `has_baths`, `county`, `has_zip`, `results_bucket` |
| `property_open` | Comprador | `source` (`own`) |
| `showing_request_started` | Comprador | `target` (`own` o `mls`) |
| `showing_request_submitted` | Comprador | `target`, `exclusive` |
| `loui_open`, `loui_message_sent` | Asistente | `lang`, `message_index` |
| `contact_form_submitted`, `whatsapp_click`, `phone_click` | Contacto | `topic` o `location`, `lang` |

**Servidor** (solo PostHog; identidad `lead:<uuid>` o `property:<uuid>`):

| Evento | Cuándo | Propiedades |
|---|---|---|
| `buyer_lead_created` | Solicitud de visita registrada | `source`, `target`, `exclusive` |
| `buyer_lead_status_changed` | La broker cambia el estado. "Contacto efectivo" = `to: contacted`; "visita realizada" = `to: completed` | `from`, `to` |
| `buyer_agreement_recorded` | La broker registra el acuerdo ("acuerdo firmado") | `type` |
| `seller_plan_purchased` | Webhook de Stripe: plan pagado | `tier` |
| `listing_published` | La broker aprueba el listing | — |

**Prohibido en cualquier evento:**
- email, nombre, teléfono, dirección o texto libre;
- contenido o identificadores de fichas del MLS;
- montos de compensación.

**Pendiente** (no hay estado en el sistema todavía): "cierre" del comprador y del vendedor.

## Pasos para activar (los hace el owner, con autorización)

### 1 · Google Tag Manager + GA4
1. **GA4:** crear una propiedad (analytics.google.com) para lixtara.com y copiar el **Measurement ID** (`G-…`).
2. **GTM:** crear un contenedor web (tagmanager.google.com) y copiar el **ID** (`GTM-…`).
3. **En GTM, crear:**
   - una etiqueta **Google tag** con el Measurement ID, disparador *Initialization – All Pages*, y en *Consent settings* exigir `analytics_storage`;
   - una etiqueta **GA4 Event** con el nombre `{{Event}}`, disparada por un *Custom Event* con la regex `^(listing_step_view|email_verified|property_search|property_open|showing_request_started|showing_request_submitted|loui_open|loui_message_sent|contact_form_submitted|whatsapp_click|phone_click)$`;
   - variables de capa de datos para las propiedades que quiera ver en GA4.
4. **Activar la vista previa de GTM**, comprobarla y **Publicar**.

### 2 · PostHog
1. Crear un proyecto en la región **US** y copiar la **Project API key** (`phc_…`).
2. **Project settings:**
   - **Discard client IP data: ON**;
   - **Session replay: OFF**;
   - **Autocapture: OFF**, como segunda barrera además del código;
   - **Heatmaps: OFF**.
3. **Embudos sugeridos:**
   - **Comprador:** `property_search` → `showing_request_started` → `showing_request_submitted` → `buyer_lead_created` → `buyer_lead_status_changed (to=contacted)` → `buyer_agreement_recorded` → `buyer_lead_status_changed (to=completed)`.
   - **Vendedor:** `listing_step_view (1)` → `listing_step_view (8)` → `seller_plan_purchased` → `listing_published`.
4. **Calidad del lead y tiempo de respuesta:** tiempo entre `buyer_lead_created` y el primer `buyer_lead_status_changed`, por persona (`lead:<id>`).

### 3 · Vercel (solo Production)
| Variable | Valor |
|---|---|
| `NEXT_PUBLIC_GTM_ID` | `GTM-…` |
| `NEXT_PUBLIC_POSTHOG_KEY` | `phc_…` |
| `NEXT_PUBLIC_POSTHOG_HOST` | (opcional) `https://us.i.posthog.com` |

Después, **Redeploy**: son variables `NEXT_PUBLIC_` y se incrustan en el build.

### 4 · Verificar
1. **En una ventana privada:** debe aparecer el banner con "Aceptar analítica" y "Rechazar". Antes de elegir no debe haber peticiones a `googletagmanager.com` ni a `posthog.com` (DevTools → Network).
2. **Rechazar:** sin peticiones, sin cookies `_ga` ni `ph_`.
3. **"Configurar cookies" (pie) → Aceptar:** carga GTM y PostHog. GA4 DebugView y PostHog Live events muestran el pageview y los eventos.
4. **En PostHog, revisar las URLs:** no deben tener `?…`, y no debe aparecer texto ni datos personales.
5. **La política de cookies** (`/en/cookies`) debe mostrar la sección 3.4 con GA4 y PostHog.

## Apagar
Borrar `NEXT_PUBLIC_GTM_ID` y `NEXT_PUBLIC_POSTHOG_KEY` en Vercel y hacer Redeploy. Vuelve el aviso informativo y la política sin analítica. Las cookies ya puestas expiran solas, o se borran si el visitante pulsa "Configurar cookies".

## Pendiente de revisión legal
Los textos del banner y de la variante con analítica de la política de cookies son un **borrador**. Conviene que los revise el abogado junto con el resto del brief.
