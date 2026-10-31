# Runbook · Analítica: GA4 (vía GTM) + PostHog

**Estado:** código listo y apagado.
- **Cada herramienta por su lado (desde 2026-10-13):** `NEXT_PUBLIC_GTM_ID` activa GTM y `NEXT_PUBLIC_POSTHOG_KEY` activa PostHog, independientes. Una variable con forma inválida se ignora sola. Sin ninguna válida no se carga nada, `track()` no hace nada y queda el aviso de cookies de siempre.
- **Opt-in en todas las regiones (decisión del owner, 2026-10-13):** el contenedor del CMO (`GTM-5KGLHNL4`) trae GA4 y Microsoft Clarity. Nada de eso se carga antes de "Aceptar". **Publicidad (decisión del owner, 2026-10-24; reemplaza la del 2026-10-15):** el píxel de Meta y Google Ads se habilitan **solo** con el consentimiento opt-in de la categoría **Publicidad**, separada de **Analítica** en el banner (ver "Publicidad con consentimiento" abajo). Sigue sin haber pauta hasta Stripe live + DocuSign producción. Se descartó el modelo opt-out por región que propuso el CMO (GTM cargado para todos, concedido por defecto fuera de UE/UK/CH) y el `<noscript>` (se saltaría el consentimiento).
- Activar = crear las cuentas + poner las variables en Vercel (Production) + redeploy, **con autorización del owner**.

**Decisión del owner (2026-10-11):**
- **GA4 = marketing y adquisición:** fuentes, campañas, SEO, Google Ads.
- **PostHog = producto:** embudos, abandono, cohortes, feature flags y, cuando haya volumen, experimentos.

## Reglas que el código ya aplica
| Regla | Dónde |
|---|---|
| Nada se carga sin consentimiento. "Aceptar" y "Rechazar" tienen el mismo estilo y tamaño. El banner aparece igual en pestañas en segundo plano | `src/components/analytics-consent.tsx` |
| Consent Mode v2: todo denegado por defecto antes de `gtm.js` y, en la misma carga, la elección guardada por categoría (`consentModeUpdate`): `analytics_storage` según Analítica; `ad_storage`, `ad_user_data` y `ad_personalization` juntas según Publicidad, y siempre denegadas en las rutas sin publicidad. Antes de `gtm.js` se empuja además `{ event: "lx_consent", lx_analytics_consent, lx_ads_consent }` | `loadGtm()` |
| Sin consentimiento, `track()` no hace nada ni encola eventos. Con consentimiento, retiene lo de PostHog mientras su SDK carga | `src/lib/analytics.ts` |
| La analítica **no corre en `/admin`** (sus URLs llevan ids de leads) | `isAnalyticsExcludedPath()` |
| Al rechazar Analítica se borran las cookies de nuestro dominio de GA4 (`_ga*`, `_gid`), Clarity (`_clck`, `_clsk`), PostHog (`ph_*`, y su almacenamiento) y `lx_ft`; al rechazar Publicidad, las de Google Ads (`_gcl_*`) y Meta (`_fbp`, `_fbc`). "Configurar cookies" en el pie borra la elección y recarga: todo vuelve a denegado hasta elegir de nuevo | `clearStorage()` / `ANALYTICS_COOKIE_RE` / `ADS_COOKIE_RE` |
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
   - una etiqueta **GA4 Event** `page_view` con el parámetro `page_location` = `{{DLV page_location}}`, disparada por el *Custom Event* `lx_page_view`. Así GA4 recibe un pageview por ruta, con la URL **sin parámetros** (en el contenedor del CMO, desde la versión 10, `page_location` se reconstruye: ver **"GTM versión 10"**);
   - una etiqueta **GA4 Event** con el nombre `{{Event}}`, disparada por un *Custom Event* con la regex `^(listing_step_view|email_verified|property_search|property_open|showing_request_started|showing_request_submitted|loui_open|loui_message_sent|contact_form_submitted|whatsapp_click|phone_click)$`, y en ella también `page_location` = `{{DLV page_location}}`;
   - etiquetas de publicidad y Clarity: ver **"Contenedor del CMO"** más abajo.
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
1. **En una ventana privada:** debe aparecer el banner con "Aceptar" y "Rechazar" (o "Aceptar analítica" si solo está PostHog). Antes de elegir no debe haber peticiones a `googletagmanager.com` ni a `posthog.com` (DevTools → Network).
2. **Rechazar:** sin peticiones, sin cookies `_ga` ni `ph_`.
3. **"Configurar cookies" (pie) → Aceptar:** carga GTM y PostHog. GA4 DebugView y PostHog Live events muestran el pageview y los eventos.
4. **En PostHog y en GA4 DebugView, revisar las URLs** (`$current_url`, `page_location`): no deben tener `?…`, y no debe aparecer texto ni datos personales. En GA4 debe haber **un** page_view por página.
5. **Entrar a `/en/admin`:** no debe haber peticiones a Google ni a PostHog.
6. **La política de cookies** (`/en/cookies`) debe mostrar en 3.4 las herramientas configuradas (GA4 y Clarity con GTM; PostHog con su variable), en 3.5 que no se usa publicidad, y en 3.3 Sentry como herramienta técnica.

### Contenedor del CMO (`GTM-5KGLHNL4`, 2026-10-13) — requisitos antes de publicar etiquetas
El sitio solo carga GTM cuando la persona ya aceptó, pero **lo que hace cada etiqueta lo decide la configuración del contenedor**. Antes de publicar GA4, Meta, Ads o Clarity:
1. **Consent settings de cada etiqueta:** GA4 exige `analytics_storage`; Google Ads y Meta exigen `ad_storage` (y `ad_user_data` / `ad_personalization` para remarketing); Clarity exige `analytics_storage`.
2. **URLs con identificadores.** Los píxeles leen la URL completa por su cuenta: en `/listing/new` la URL puede llevar `id` (propiedad) y `session_id` (Stripe), y en el resto del flujo de cuenta, parámetros de estado. Nuestro `sanitizeUrl` solo limpia los eventos que enviamos nosotros. Por eso:
   - GA4: usar `page_location` = `{{DLV page_location}}` (ya sin parámetros) y `send_page_view = false`, como arriba;
   - Meta Pixel y Google Ads: agregar una **excepción de disparador** para `Page Path` que empiece con `/en/listing/`, `/es/listing/`, `/en/account`, `/es/account`, `/en/auth`, `/es/auth`, o bien pasar la URL sin parámetros en el campo de URL de la etiqueta;
   - Clarity: **masking "Strict"** y excluir en la carga de página **solo `/account` y `/admin`** (en y es). **Decisión del owner 2026-10-16** (reemplaza la del 2026-10-14): Clarity graba todo el embudo, es decir, páginas públicas, `/listing`, `/auth`, `/sign-in` y `/sign-up`. Clarity no se puede detener en una navegación sin recarga, así que el sitio entra a `/account` siempre con **carga completa**, y sale de ella con carga completa cuando hay consentimiento, para que Clarity se vuelva a cargar en el embudo (`src/components/recording-guard.tsx`, reglas en `isRecordingExcludedPath` / `needsFullLoad`). Hay además un respaldo con `data-clarity-mask="true"`:
     - el layout de `/account` y el de `/dashboard` (el panel se graba, pero todo enmascarado);
     - las fotos del inmueble en `/listing` (la cuadrícula del paso 5 y las miniaturas del paso 6).
     - DocuSign y Stripe ocurren fuera del sitio.
3. **`/admin`** nunca carga GTM (lo impide el código).
4. **Publicidad:** ver "Publicidad con consentimiento (2026-10-24)". La Privacidad v4 (§4.6, §6.2, §6.3, §9.1) y la Cookies v4 ya describen Meta y Google Ads con consentimiento (pendientes de revisión del abogado: `docs/legal/2026-10-24-textos-v4-memo.md`).

### Publicidad con consentimiento (2026-10-24)
Desde la v4, **GTM se carga si la persona aceptó al menos una categoría**: alguien puede aceptar Publicidad y rechazar Analítica. Por eso el contenedor tiene que separar las categorías **antes** de que el código llegue a Production; si no, una persona que solo acepta Publicidad cargaría GA4 y Clarity.

#### Para el CMO: cambios del contenedor `GTM-5KGLHNL4` que se publican ANTES del merge del PR #225
Publicar una versión del contenedor con **todos** estos cambios y avisar el número de versión; el merge espera esa confirmación.

| # | Etiquetas | Cambio exacto |
|---|---|---|
| 1 | GA4 (Google tag y eventos) y Microsoft Clarity | *Consent settings* → *Require additional consent for tag to fire* → `analytics_storage`. Disparadores: agregar la condición `lx_analytics_consent` *equals* `granted` (variable de capa de datos `lx_analytics_consent`, versión 2). |
| 2 | Meta Pixel y Google Ads (conversiones y remarketing) | *Consent settings* → exigir `ad_storage`. Disparadores: agregar la condición `lx_ads_consent` *equals* `granted` (variable de capa de datos `lx_ads_consent`, versión 2). |
| 3 | Meta Pixel | **Automatic advanced matching desactivado** (en la configuración del píxel en Events Manager y, si la plantilla lo ofrece, en la etiqueta). Sin advanced matching manual: no se envían correos, teléfonos ni nombres a Meta. |
| 4 | Todas las de publicidad (Meta y Google Ads) | **Ninguna** dispara en `/listing`, `/account`, `/auth`, `/sign-in`, `/sign-up`, `/dashboard` ni `/admin` (en y es): excepción de disparador con `Page Path` que coincida con la expresión regular `^/(en\|es)/(listing\|account\|auth\|sign-in\|sign-up\|dashboard\|admin)(/\|$)`. Es una segunda barrera: el código ya deja ahí `lx_ads_consent` = `denied` y las tres señales `ad_*` denegadas. |

Verificación en *Preview* de GTM, con el sitio del PR:
- **Aceptar solo Publicidad:** GA4 y Clarity no disparan; Meta y Ads sí, solo fuera de las rutas del punto 4.
- **Aceptar solo Analítica:** Meta y Ads no disparan.
- **Navegador con GPC** (por ejemplo, Brave, o Firefox con GPC activado): Meta y Ads no disparan aunque se acepte todo.

Detalle de cada regla:
1. **GA4 y Clarity:** *Consent settings* → exigir `analytics_storage`; además, condición de disparo `lx_analytics_consent` = `granted` (variable de capa de datos). Clarity no lee Consent Mode de forma fiable: la condición del disparador es la barrera.
2. **Meta Pixel (plantilla de la galería) y Google Ads (conversiones y remarketing):** *Consent settings* → exigir `ad_storage`, `ad_user_data` y `ad_personalization`; condición de disparo `lx_ads_consent` = `granted`. El píxel de Meta no lee Consent Mode: la condición del disparador es la barrera.
3. **Rutas sin publicidad:** en `/listing`, `/account`, `/auth`, `/sign-in`, `/sign-up`, `/dashboard` y `/admin` el código deja las tres señales `ad_*` en `denied` y `lx_ads_consent` = `denied` aunque haya consentimiento (`isAdsExcludedPath`). Cruzar ese límite con Publicidad aceptada fuerza carga completa (`RecordingGuard` / `needsFullLoad`). La excepción por `Page Path` del punto 2 de arriba queda como respaldo.
4. **Eventos propios:** `track()` y `lx_page_view` salen **solo con Analítica**. Con Publicidad sola, Meta y Ads usan los disparadores de GTM (p. ej. *All Pages* / *History Change*) y no reciben los `lx_*`. Si el CMO quiere conversiones de Meta con eventos `lx_*` sin Analítica, es una decisión aparte.
5. **Stripe:** la metadata del Checkout lleva `ads_consent` y, **solo con Publicidad aceptada**, `fbp`, `fbc` y `gclid` (de `_gcl_aw`). El `purchase` de GA4 por Measurement Protocol manda `ad_user_data` / `ad_personalization` = `GRANTED` solo si `ads_consent` = `granted`.
6. **API de Conversiones de Meta:** **no existe** en el código ni en las políticas. El PR que la construya agrega en el mismo cambio su texto de Privacidad. Ese envío debe leer el consentimiento de Publicidad guardado y Global Privacy Control (como la metadata de Stripe), nunca suponerlos.
7. **Valores viejos de `lx_consent`:** `granted` / `denied` (antes de la v4, solo analítica) se leen con Publicidad **denegada** y el banner no vuelve a salir; quien quiera publicidad la acepta en "Configurar cookies".
8. **Global Privacy Control:** con `navigator.globalPrivacyControl === true`, la Publicidad queda denegada (`effectiveConsent`): las tres señales `ad_*` y `lx_ads_consent` quedan en `denied`, el banner no deja aceptarla y lo dice en esa categoría, y la metadata de Stripe la trata como denegada si el request trae `Sec-GPC: 1`. La Analítica no cambia.

## Apagar
Borrar `NEXT_PUBLIC_GTM_ID` y `NEXT_PUBLIC_POSTHOG_KEY` en Vercel y hacer Redeploy. Vuelve el aviso informativo y la política sin analítica. Las cookies ya puestas expiran solas, o se borran si el visitante pulsa "Configurar cookies".

## Pendiente de revisión legal
Los textos del banner y de la variante con analítica de la política de cookies son un **borrador**. Están en el paquete del abogado: `docs/planning/2026-10-compradores/05-textos-consentimiento-cookies.md` (pregunta 17 del brief).

## Embudo del vendedor y compras (2026-10-14)
- **dataLayer:** `listing_cta_click`, `listing_step_complete` (1–7), `agreement_signed`, `begin_checkout` (`eventTimeout` 1,2 s; sin respuesta de GTM redirige igual a los 1,5 s), `listing_step_error`, `listing_resumed`, `calculator_used`. Valores según la spec del CMO del 2026-10-19 (ver "Spec de eventos del CMO"). `listing_step_view` lleva `plan_tier` desde el paso 3. En cada ruta, `lx_page_view` sale **antes** que los eventos de la página (esperan hasta 3 s).
- **Supabase:** `funnel_events` (con `is_test`) → `listing_funnel_v`, una fila por listing real. `is_test` = entorno distinto de Production, propiedad `is_test` o Stripe `livemode=false`.
- **`broker_countersigned`** (solo servidor, `funnel_events`, con `is_test`): la broker contrafirmó en DocuSign. Se registra una vez, en la transición del acuerdo a `completed`, y solo si la firma de la broker está verificada. Aún no es columna de `listing_funnel_v` (requiere otra migración).
- **GA4 `purchase`** desde el webhook de Stripe (Measurement Protocol): solo con consentimiento `granted` guardado en el Checkout, `livemode`, Production y propiedad no `is_test`. `transaction_id` = id de la sesión de Stripe.
- **Validar el webhook con una compra real reembolsada:** marcar ese listing `is_test` **antes** de pagar (ver "Marcar un listing de prueba en producción"); así no cuenta en el tablero ni como ingreso en GA4, y se verifica directo en `funnel_events`. En Preview no hace falta: lo que se crea fuera de Production ya queda `is_test` y Stripe está en modo de prueba.


## Portada y landing de propietarios (2026-10-18)

### Enlace de Instantly
```
https://lixtara.com/en/owners?utm_source=instantly&utm_medium=email&utm_campaign=<campaña>
https://lixtara.com/es/owners?utm_source=instantly&utm_medium=email&utm_campaign=<campaña>
```
- `<campaña>`: minúsculas, números, `.`, `_` o `-`, hasta 64 caracteres. Las campañas de Instantly llevan el prefijo `lx_` (p. ej. `lx_fl-owners-2026-10`). Los espacios pasan a `_`. Si trae otra cosa (`@`, acentos), se descarta.
- **Nunca** se agrega al enlace ningún dato del propietario: ni nombre, ni dirección, ni email, ni `owner_key`, ni variables de Instantly como `{{firstName}}`. La página no se personaliza.
- Helper: `ownersInstantlyUrl()` (`src/lib/owners-landing.ts`).

### Qué se registra
- **Primer contacto (con consentimiento):** la cookie `lx_ft` guarda `source|medium|campaign` en la primera visita con UTM. El paso 1 del registro la lleva a `funnel_events` y a `listing_funnel_v`. No cambió.
- **`lx_page_view` (con consentimiento):** cuando la URL trae UTM, lleva además `campaign_source`, `campaign_medium` y `campaign_name`, ya saneados. `page_location` sigue **sin parámetros**. PostHog recibe los mismos valores como `utm_source`, `utm_medium` y `utm_campaign` en `$pageview`.
- **`listing_cta_click`:** `location` = `home_hero` (portada; **antes `hero`**), `owners_hero` u `owners_footer` (landing). Las demás ubicaciones no cambian (`header`, `pricing`, `footer`, `plan_quiz`, `about`).
- **`owners_landing_view` (servidor, sin consentimiento):** una fila en `funnel_events` por visita de navegador a `/owners`. Lleva solo `metadata.lang`, y `property_id`, `user_id` y `session_id` vacíos (no entra a `listing_funnel_v`). No cuenta bots, escáneres de enlaces de correo, clientes HTTP ni prefetch (`isHumanPageView`). `is_test` = entorno distinto de Production.

```sql
-- Visitas a /owners por día e idioma (Production)
select date_trunc('day', created_at at time zone 'America/New_York') as dia,
       metadata->>'lang' as lang, count(*) as visitas
  from public.funnel_events
 where event = 'owners_landing_view' and is_test = false
 group by 1, 2 order by 1 desc, 2;
```

### Qué configura el CMO en GTM (`GTM-5KGLHNL4`)
1. **Variables de capa de datos:** `campaign_source`, `campaign_medium`, `campaign_name`, `location`, `lang` y `tier`.
2. **Etiqueta GA4 Event `page_view`** (la que dispara `lx_page_view`): agregar los parámetros `campaign_source` = `{{DLV campaign_source}}`, `campaign_medium` = `{{DLV campaign_medium}}` y `campaign_name` = `{{DLV campaign_name}}`. Sin esto, GA4 atribuye estas visitas a "direct", porque `page_location` va sin UTM.
3. **Etiqueta GA4 Event `{{Event}}`:** agregar `listing_cta_click` a la regex del disparador, con los parámetros `location`, `lang` y `tier`.
4. **GA4 → Admin → Custom definitions:** dimensión de evento `location` (y `tier`, si no existe).
5. **Informes:** donde se filtraba `location = hero`, ahora es `home_hero`.
6. **Verificar en GTM Preview y en GA4 DebugView:** abrir `/en/owners?utm_source=instantly&utm_medium=email&utm_campaign=prueba`, aceptar cookies y comprobar que `page_view` lleva `campaign_source = instantly`. Pulsar "Start my listing" y comprobar `listing_cta_click` con `location = owners_hero`.

### GTM versión 10 (publicada por el CMO, 2026-10-19)
Cambio solo en el contenedor; el código no cambió.
- **`page_location` de la etiqueta `page_view`:** se reconstruye a partir de la URL original, de la que conserva **solo** los parámetros `utm_*` y los IDs de clic de Google Ads (`gclid`, `gbraid`, `wbraid`). Cualquier otro parámetro se descarta.
- **Si la URL no trae UTM**, la etiqueta agrega a `page_location` solo `utm_source`, `utm_medium` y `utm_campaign`, tomados de `campaign_source`, `campaign_medium` y `campaign_name` de `lx_page_view`.
- **`lx_page_view` no se cambia:** el CMO depende de `campaign_source`, `campaign_medium` y `campaign_name`. En el dataLayer, `page_location` sigue sin parámetros; la reconstrucción la hace GTM.
- **Campañas de Instantly:** prefijo `lx_` en `utm_campaign` (ver "Enlace de Instantly").

### Pendiente para cuando se active Google Ads
- **Política de cookies y banner:** mencionar `gclid`, `gbraid` y `wbraid` (IDs de clic de Google Ads que la etiqueta `page_view` conserva en `page_location` y envía a GA4). La Cookies v4 ya nombra el `gclid` en `_gcl_aw`; `gbraid` / `wbraid` en `page_location` siguen pendientes (ver el memo v4).

## Spec de eventos del CMO (2026-10-19 y 10-20, GTM-5KGLHNL4 v12)
Nombres y valores que GTM y GA4 esperan tal cual; cambiar uno parte los datos en dos, así que se avisa al CMO **antes**. Lo fija `src/lib/analytics-cmo-spec.test.ts`.
- **`listing_step_view`:** `plan_tier` desde el paso 3 (el plan se elige en el 2); antes no se manda.
- **`agreement_signed`:** al volver de DocuSign con la firma ya confirmada en la base (`signed` o `completed`). Una vez por listing: se quita el marcador `?signed=1` y la pestaña recuerda el listing en `sessionStorage` (el ID nunca sale del navegador). Lleva `plan_tier` y `lang`.
- **`begin_checkout`:** ya creada la sesión de Stripe, antes de redirigir. `value` = `flatFee` del plan (`pricing-tiers.ts`), el mismo monto que cobra Stripe; `currency: "USD"`. Sin consentimiento redirige enseguida.
- **`listing_resumed`:** `step` y `source`:
  - `email`: el enlace que pide el vendedor en `/listing/continue` (`?resumed=email_link`);
  - `broker`: el enlace que manda la broker desde `/admin/seller-leads` (`?resumed=broker_link`);
  - `account`: botón "Continuar" del panel (`?resumed=account`);
  - `direct`: primera vista del flujo en la pestaña, sin marcador, en un borrador propio a partir del paso 2.
  **Sin UTM en estos enlaces** (decisión del CMO, 2026-10-20): le quitarían el crédito a la campaña que trajo al vendedor. El marcador propio `?resumed=` cumple el papel del `?from=` que propuso el CMO; el navegador lo quita de la URL y, desde GTM v10, `page_location` solo conserva `utm_*` y los IDs de clic.
  En `funnel_events` (servidor) se guarda el marcador original (`email_link`, `broker_link`, `account`); `direct` solo existe en el navegador.
- **`calculator_used`:** una vez por visita (por pestaña; la calculadora está en la portada y en `/owners`), cuando la persona deja de mover los controles 1,5 s. `home_price_range`: `under_300k`, `300k_500k`, `500k_1m`, `1m_2m`, `2m_plus`. `commission_mode`: `none`, `percent` o `amount` (nunca el monto). **Sin `plan`** (decisión del CMO, 2026-10-20): la calculadora compara los tres planes; el plan se ve en `listing_cta_click` (`tier`) y en `plan_tier`. `commission_mode` está conectado en GTM v12 y en GA4.

## Marcar un listing de prueba en producción
El admin **no** tiene un botón para esto (el vendedor no puede escribir `is_test`: lo impide `guard_properties_seller_columns`). Lo hace el owner en el **SQL Editor de Supabase**, proyecto `fizhoufepowilbhbtfkg`, **antes** de pagar. Usado el 2026-10-20 en la prueba del CMO con Tag Assistant.

1. **Encontrar el listing.** Buscar por correo puede no encontrarlo: hasta el paso 7 la cuenta puede ser anónima o tener otro correo. Lo seguro es ver los últimos creados:
   ```sql
   select id, owner_id, pricing_tier, mls_status, is_test, created_at
     from public.properties
    order by created_at desc
    limit 5;
   ```
2. **Marcarlo con sus eventos y su lead** (cambiar el id; un id de ejemplo como `ID-DEL-LISTING` falla con `invalid input syntax for type uuid`):
   ```sql
   with l as (select id from public.properties where id = '00000000-0000-0000-0000-000000000000'),
   a as (update public.properties    set is_test = true where id in (select id from l) returning 1),
   b as (update public.funnel_events set is_test = true where property_id in (select id from l) returning 1),
   c as (update public.seller_leads  set is_test = true where property_id in (select id from l) returning 1)
   select (select count(*) from a) as listings, (select count(*) from b) as eventos, (select count(*) from c) as leads;
   ```
   `listings` debe ser 1. Los eventos y el lead ya escritos quedaron como reales: por eso se marcan también.
3. **Después de pagar:** reembolsar desde Stripe si fue con tarjeta real; el listing queda en `pending_approval` (no aprobarlo). `pnpm cleanup:test-data` lo encuentra después, porque ya es `is_test`.
