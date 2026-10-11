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
| Nada se carga sin consentimiento. "Aceptar" y "Rechazar" tienen el mismo estilo y tamaño. El banner aparece igual en pestañas en segundo plano | `src/components/analytics-consent.tsx` |
| Consent Mode v2: publicidad siempre denegada, solo `analytics_storage` concedido al aceptar | `loadGtm()` |
| Sin consentimiento, `track()` no hace nada ni encola eventos. Con consentimiento, retiene lo de PostHog mientras su SDK carga | `src/lib/analytics.ts` |
| La analítica **no corre en `/admin`** (sus URLs llevan ids de leads) | `isAnalyticsExcludedPath()` |
| Al rechazar o retirar el consentimiento ("Configurar cookies" en el pie) se borran `_ga*`, `ph_*` y el almacenamiento de PostHog | `clearAnalyticsStorage()` |
| PostHog **sin autocapture** (no lee textos, imágenes ni URLs de fichas del MLS), **sin grabación de sesión**, sin heatmaps, rage/dead clicks, rendimiento, errores, encuestas ni experimentos; texto enmascarado; sin título de página; `person_profiles: identified_only` | `loadPosthog()` |
| URLs **sin parámetros ni fragmento** en PostHog (`$current_url`, referrers) | `sanitizeUrl()` |
| **Un pageview por ruta y por herramienta**, con la URL sin parámetros: `$pageview` en PostHog y el evento `lx_page_view` en el dataLayer para GA4. El Google tag **no** debe enviar su page_view automático (ver paso 1) | `pageview()` |
| Eventos comerciales desde el **servidor**, por cambio de estado verificable. **No salen de nuestra infraestructura**: una línea `lx_server_event` en los logs de Vercel, sin identificadores | `src/lib/analytics.server.ts` |
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

**Servidor** (solo en nuestros logs de Vercel, `lx_server_event`; **no** van a PostHog ni a GA4, porque un evento de servidor no conoce el consentimiento del visitante; sin identificadores):

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
   - variables de capa de datos `page_location` y `page_path`;
   - una etiqueta **Google tag** con el Measurement ID, disparador *Initialization – All Pages*, en *Consent settings* exigir `analytics_storage`, y en *Configuration settings* el parámetro **`send_page_view` = `false`**;
   - una etiqueta **GA4 Event** `page_view` con el parámetro `page_location` = `{{DLV page_location}}`, disparada por el *Custom Event* `lx_page_view`. Así GA4 recibe un pageview por ruta, con la URL **sin parámetros**;
   - una etiqueta **GA4 Event** con el nombre `{{Event}}`, disparada por un *Custom Event* con la regex `^(listing_step_view|email_verified|property_search|property_open|showing_request_started|showing_request_submitted|loui_open|loui_message_sent|contact_form_submitted|whatsapp_click|phone_click)$`, y en ella también `page_location` = `{{DLV page_location}}`;
   - **no** agregar etiquetas de publicidad (Google Ads, remarketing) ni de terceros.
4. **Activar la vista previa de GTM**, comprobarla y **Publicar**.

1b. **En GA4 → Data streams → Enhanced measurement:** desactivar *Page changes based on browser history events*, *Form interactions* y *Site search*. La primera duplicaría pageviews; las otras dos pueden leer parámetros o campos de formularios.

### 2 · PostHog
1. Crear un proyecto en la región **US** y copiar la **Project API key** (`phc_…`).
2. **Project settings:**
   - **Discard client IP data: ON**;
   - **Session replay: OFF**;
   - **Autocapture: OFF**, como segunda barrera además del código;
   - **Heatmaps: OFF**.
3. **Embudos sugeridos:**
   - **Comprador (navegador):** `property_search` → `property_open` → `showing_request_started` → `showing_request_submitted`. Lo que sigue (contacto, acuerdo, visita) sale de la base de datos.
   - **Vendedor (navegador):** `listing_step_view (1)` → `listing_step_view (8)`. Pago y publicación salen de la base de datos y de los logs `lx_server_event`.
4. **Calidad del lead y tiempo de respuesta:** salen de la base de datos (`buyer_leads` y su historial de estados), no de PostHog, porque los eventos de servidor no salen de nuestra infraestructura.

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
4. **En PostHog y en GA4 DebugView, revisar las URLs** (`$current_url`, `page_location`): no deben tener `?…`, y no debe aparecer texto ni datos personales. En GA4 debe haber **un** page_view por página.
5. **Entrar a `/en/admin`:** no debe haber peticiones a Google ni a PostHog.
6. **La política de cookies** (`/en/cookies`) debe mostrar la sección 3.4 con GA4 y PostHog.

## Apagar
Borrar `NEXT_PUBLIC_GTM_ID` y `NEXT_PUBLIC_POSTHOG_KEY` en Vercel y hacer Redeploy. Vuelve el aviso informativo y la política sin analítica. Las cookies ya puestas expiran solas, o se borran si el visitante pulsa "Configurar cookies".

## Pendiente de revisión legal
Los textos del banner y de la variante con analítica de la política de cookies son un **borrador**. Están en el paquete del abogado: `docs/planning/2026-10-compradores/05-textos-consentimiento-cookies.md` (pregunta 17 del brief).
