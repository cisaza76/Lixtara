# Textos legales v4 (Publicidad con consentimiento): memo para el abogado

**Para:** abogado de Lixtara LLC
**Fecha:** 2026-10-24
**Estado:** **PENDIENTE DE REVISIÓN.** No están publicados: viven en un PR sin merge y en un Preview. No hay pauta hasta Stripe live + DocuSign producción.

- Memo anterior: `2026-10-18-textos-v2-memo.md` (v2, publicada).
- El texto de abajo se genera del mismo código que publica el sitio (variante con Google Tag Manager configurado, como en Production).

## Decisión del owner (2026-10-24)

Se habilitan el píxel de Meta y Google Ads **solo** con consentimiento opt-in de la categoría **Publicidad**, separada de **Analítica**. Reemplaza la decisión del 2026-10-15 ("Google Ads y Meta no están aprobados").

## Qué cambia

| Documento | Versión | Cambio |
|---|---|---|
| Aviso de cookies (banner) | — | Dos categorías (Analítica y Publicidad) con "Aceptar" y "Rechazar" del mismo peso visual en cada una; "Rechazar todo", "Guardar elección" y "Aceptar todo" con el mismo estilo. Todo rechazado por defecto. Se quita "No usamos cookies de publicidad". |
| Política de Cookies | 2026-10-18-v2 → **2026-10-24-v4** | §2, §4 y §8 por categoría; §6 pasa a "Cookies de Publicidad (solo con su consentimiento)" con `_fbp`, `_fbc` (Meta) y `_gcl_au`, `_gcl_aw` (Google Ads); `lx_consent` guarda las dos elecciones. Sin GTM la política sigue diciendo que no hay publicidad. |
| Política de Privacidad | 2026-10-18-v2 → **2026-10-24-v4** | §4.1 suma Meta (píxel) y Google Ads; §4.6 reescrita (compartición para publicidad solo con consentimiento, cómo negarse); §6.2 nueva (publicidad y medición de campañas); §6.3 nueva (retiro); §9.1 California, con Global Privacy Control. **Sin** la API de Conversiones de Meta: no existe, y su texto se agrega en el mismo PR que la construya. |
| Términos | sin cambios (2026-10-18-v2) | No mencionan cookies ni publicidad. |
| Casilla de registro | versión `terms-2026-10-21-v3+privacy-2026-10-24-v4` | Mismo texto (mismo hash); cambia la versión de la Privacidad que se acepta. Las versiones anteriores (v2 y Términos v3 con Privacidad v2) quedan registradas como anteriores. |

## Cómo funciona (lo que los textos describen)

- **Por defecto todo denegado** (Consent Mode v2: `ad_storage`, `ad_user_data`, `ad_personalization` y `analytics_storage` en `denied` antes de cargar GTM).
- **Aceptar Publicidad** → `ad_storage`, `ad_user_data` y `ad_personalization` = `granted`. La elección se guarda en `lx_consent` y se reaplica en cada carga antes de GTM.
- **Rutas sin publicidad:** `/listing`, `/account`, `/auth`, `/sign-in`, `/sign-up`, `/dashboard` y `/admin` quedan con publicidad denegada aunque se haya aceptado, con carga completa al entrar y al salir.
- **Retiro:** "Configurar cookies" (pie) borra la elección y recarga; todo vuelve a denegado hasta elegir de nuevo. Rechazar una categoría borra sus cookies en nuestro dominio.
- **Global Privacy Control:** si el navegador manda GPC, la Publicidad queda rechazada: no se puede aceptar y el aviso dice "Tu navegador pidió no compartir datos para publicidad". La Analítica no cambia.
- **Stripe:** `_fbp`, `_fbc` y `gclid` van a la metadata del Checkout solo con Publicidad aceptada y sin GPC (header `Sec-GPC`).

## Preguntas para el abogado

1. **¿"Venta" o solo "compartir"?** La v4 sigue diciendo "no vendemos su información personal por dinero" y llama "compartir" a lo que va a Meta y Google. Bajo la CCPA, los datos de un píxel a cambio de servicios de publicidad pueden considerarse "venta" (contraprestación no monetaria). ¿Basta la redacción actual, o hay que decir "vender o compartir" y ofrecer un enlace "Do Not Sell or Share"?
2. **Florida Digital Bill of Rights.** ¿Aplica a Lixtara (umbrales)? Si aplica, la publicidad dirigida exige un opt-out; aquí ya es opt-in.
3. **Condiciones de Herramientas para Empresas de Meta** (https://www.facebook.com/legal/terms/businesstools) y políticas de Google Ads: exigen aviso y consentimiento. ¿Basta lo de la §6.2 y la §6.3 de Privacidad y la §6 de Cookies? El píxel va con "automatic advanced matching" desactivado (runbook de analítica).
4. **Duraciones** (solo fuentes oficiales, 2026-10-24).
   - **Google:** `_gcl_au` y `_gcl_aw` duran 90 días, según su página de cookies publicitarias (https://business.safety.google/adscookies/).
   - **Meta:** no publica el plazo de `_fbp` en una página oficial que se pueda comprobar. Para `_fbc`, su guía de fbp/fbc de la API de Conversiones solo recomienda 90 días a quien la pone desde su servidor. La tabla dice "aproximadamente 90 días (la fija Meta)" para las dos.
5. **IDs de clic en GA4:** el contenedor (v10) conserva `gclid`, `gbraid` y `wbraid` en el `page_location` que va a GA4, incluso solo con Analítica aceptada. ¿Hay que mencionarlo en la §4 de Cookies, o pedir al CMO que los quite cuando Publicidad esté rechazada?
6. **Elecciones anteriores.** Quien aceptó la analítica antes de la v4 queda con Publicidad **rechazada** y no se le vuelve a preguntar (la puede aceptar en "Configurar cookies"). ¿Conforme, o hay que volver a mostrar el banner a todos?
7. **Do Not Track (§12).** Sin cambios: el sitio no responde a DNT y sí a Global Privacy Control (§9.1). ¿Conforme?

## Textos (generados del código)

## Aviso de cookies (ES, con GTM)

Usamos cookies esenciales para que el sitio funcione. Con tu permiso, también usamos cookies de analítica (Google Analytics y Microsoft Clarity, que graba cómo se usan las páginas con tu información personal oculta) para mejorar el sitio, y cookies de publicidad (Meta y Google Ads) para medir nuestras campañas y mostrarte nuestros anuncios. Puedes aceptar o rechazar cada categoría.

Categorías: **Analítica** y **Publicidad**, cada una con [Rechazar] [Aceptar]. Botones: [Rechazar todo] [Guardar elección] [Aceptar todo]. Enlace: Política de cookies. Pie: Configurar cookies.

Con Global Privacy Control, en la categoría Publicidad: "Tu navegador pidió no compartir datos para publicidad." ([Aceptar] desactivado).

## Aviso de cookies (EN, con GTM)

We use essential cookies to run the site. With your permission, we also use analytics cookies (Google Analytics and Microsoft Clarity, which records how pages are used with personal information hidden) to improve the site, and advertising cookies (Meta and Google Ads) to measure our campaigns and show you our ads. You can accept or reject each category.

Categorías: **Analytics** y **Advertising**, cada una con [Reject] [Accept]. Botones: [Reject all] [Save choices] [Accept all]. Enlace: Cookie Policy. Pie: Cookie settings.

Con Global Privacy Control, en la categoría Advertising: "Your browser asked not to share data for advertising." ([Accept] desactivado).

## Política de Cookies v4 (ES), secciones que cambian

### 2. Cómo las Usamos

Usamos cookies necesarias para que el sitio funcione y, solo si usted acepta cada categoría por separado, cookies de analítica para entender cómo se usa el sitio y mejorarlo (Sección 4) y cookies de publicidad para medir nuestras campañas y mostrarle anuncios de Lixtara (Sección 6).

### 3. Cookies Estrictamente Necesarias

Sin estas cookies usted no podría iniciar sesión, publicar su listado ni guardar su elección sobre las cookies. Por eso no dependen del aviso de cookies.

| Nombre | Proveedor | Finalidad | Duración |
|---|---|---|---|
| sb-<project>-auth-token (may be split into .0, .1) | Lixtara (Supabase Auth) | Mantiene su sesión iniciada y protege las acciones de su cuenta y del listado. | Hasta que cierre sesión o la sesión venza |
| lx_consent | Lixtara | Guarda su elección en el aviso de cookies (aceptar o rechazar la analítica y la publicidad, por separado). | 365 días |
| lx_step1_form | Lixtara | Conserva la dirección y el correo que escribió en el paso 1 del listado si el envío falla o si inicia sesión, para que no los pierda. | 30 minutos |
| lx_signup_email | Lixtara | Recuerda el correo con el que se registró para la pantalla del código de verificación, sin ponerlo en la dirección de la página. | 1 hora |
| lixtara_cookie_notice_dismissed (local storage) | Lixtara | Recuerda que cerró el aviso de cookies, para no mostrarlo en cada página. | Hasta que borre los datos del sitio en su navegador |

### 4. Cookies de Analítica (solo con su consentimiento)

Solo si usted acepta la categoría Analítica en el aviso de cookies, usamos Google Analytics 4 (cargado mediante Google Tag Manager), para medir el tráfico y de dónde llegan las visitas y Microsoft Clarity, para entender cómo se usan las páginas mediante mapas de calor y grabaciones de sesión. Si rechaza, estas herramientas no se activan. Los eventos que enviamos nosotros llevan direcciones de página sin parámetros y nunca el texto que usted escribe.

Clarity oculta el texto y los datos que usted escribe, y nosotros ocultamos además las fotos, los documentos y las firmas. No se graba su área de cuenta (/account) ni el pago, que procesa Stripe en sus propias páginas.

Microsoft no publica hoy la duración de las cookies de Clarity; las duraciones de la tabla son aproximadas y las fija Microsoft.

| Nombre | Proveedor | Finalidad | Duración |
|---|---|---|---|
| lx_ft | Lixtara | Guarda de qué campaña o sitio llegó por primera vez (parámetros UTM, sin datos personales), para medir nuestras campañas. | 90 días |
| _ga | Google LLC (Google Analytics 4) | Distingue visitantes para las estadísticas de uso. | Hasta 2 años (la fija Google) |
| _ga_<container-id> | Google LLC (Google Analytics 4) | Mantiene el estado de la sesión para las estadísticas de uso. | Hasta 2 años (la fija Google) |
| _clck | Microsoft (Clarity) | Identificador seudónimo de Clarity y sus preferencias en este sitio. | Aprox. 1 año |
| _clsk | Microsoft (Clarity) | Une las páginas que visita en una misma grabación de sesión. | Aprox. 1 día |
| CLID | Microsoft (Clarity), en dominios de Microsoft | Indica la primera vez que Clarity vio a este navegador en cualquier sitio que use Clarity. | Aprox. 1 año |
| MUID | Microsoft, en dominios de Microsoft | Identifica navegadores que visitan sitios de Microsoft. Microsoft la pone en sus propios dominios y la usa para sus propios fines, descritos en su declaración de privacidad. Lixtara no la usa. | Aprox. 1 año |
| ANONCHK | Microsoft, en dominios de Microsoft | Indica si el MUID se transfiere a otra cookie de Microsoft usada para publicidad; Clarity no la usa y su valor es siempre 0. | Aprox. 10 minutos |
| MR | Microsoft, en dominios de Microsoft | Indica si hay que renovar el MUID. | Aprox. 7 días |
| SM | Microsoft, en dominios de Microsoft | Sincroniza el MUID entre dominios de Microsoft. | Sesión (se borra al cerrar el navegador) |

### 6. Cookies de Publicidad (solo con su consentimiento)

Solo si usted acepta la categoría Publicidad en el aviso de cookies, activamos, mediante Google Tag Manager, el píxel de Meta (Meta Platforms, Inc.) y la medición de conversiones de Google Ads (Google LLC). Los usamos para medir nuestras campañas (por ejemplo, saber si un registro o un pago llegó desde un anuncio) y para mostrarle anuncios de Lixtara en Facebook, Instagram, Google y otros sitios. Si rechaza esta categoría, no se activan y no ponen estas cookies. Lixtara no muestra publicidad de terceros en su sitio.

Aunque usted la haya aceptado, la publicidad no se activa en el proceso de publicación de su vivienda, en su cuenta, en el inicio de sesión y el registro, ni en su panel.

Si su navegador envía la señal Global Privacy Control, la publicidad queda rechazada en ese navegador, aunque la acepte en el aviso (Política de Privacidad, Sección 9.1).

Meta y Google pueden además poner cookies en sus propios dominios y las usan según sus propias políticas de privacidad. Las duraciones de la tabla las fijan Meta y Google.

Si usted acepta la analítica, Microsoft puede poner cookies en sus propios dominios (Sección 4). Microsoft las usa según su propia declaración de privacidad; Lixtara no las usa para publicidad.

| Nombre | Proveedor | Finalidad | Duración |
|---|---|---|---|
| _fbp | Meta Platforms, Inc. | Identifica su navegador para medir nuestras campañas en Meta y mostrarle anuncios de Lixtara. | Aproximadamente 90 días (la fija Meta) |
| _fbc | Meta Platforms, Inc. | Guarda el identificador del clic cuando llega desde un anuncio de Meta (parámetro fbclid), para atribuir el registro o el pago a ese anuncio. | Aproximadamente 90 días (la fija Meta) |
| _gcl_au | Google LLC (Google Ads) | Mide las conversiones (registros y pagos) de nuestras campañas de Google Ads. | 90 días (la fija Google) |
| _gcl_aw | Google LLC (Google Ads) | Guarda el identificador del clic cuando llega desde un anuncio de Google (parámetro gclid), para atribuir el registro o el pago a ese anuncio. | 90 días (la fija Google) |

### 8. Cómo Elegir o Retirar su Consentimiento

Cuando visita Lixtara por primera vez, el aviso de cookies le permite aceptar o rechazar por separado las cookies de analítica y las de publicidad, con "Aceptar" y "Rechazar" igual de visibles en cada categoría, y también "Rechazar todo" y "Aceptar todo". Las dos categorías están rechazadas hasta que usted acepte: nada de analítica ni de publicidad se activa antes.

Puede cambiar su elección o retirar su consentimiento en cualquier momento en "Configurar cookies", en el pie del sitio. Al hacerlo, las dos categorías vuelven a quedar rechazadas hasta que elija de nuevo; las herramientas de la categoría que rechace dejan de activarse y las cookies que pusieron en nuestro dominio se borran de su navegador. Las cookies que Microsoft, Meta o Google ponen en sus propios dominios solo se pueden borrar desde el navegador.

- También puede ver, bloquear o borrar cookies desde la configuración de su navegador.
- Si bloquea las cookies necesarias, no podrá iniciar sesión ni usar el proceso de publicación.

## Política de Cookies v4 (EN), secciones que cambian

### 2. How We Use Them

We use necessary cookies so the site works and, only if you accept each category separately, analytics cookies to understand how the site is used and improve it (Section 4) and advertising cookies to measure our campaigns and show you Lixtara ads (Section 6).

### 3. Strictly Necessary Cookies

Without these cookies you could not sign in, publish your listing or save your cookie choice. That is why they do not depend on the cookie banner.

| Name | Provider | Purpose | Duration |
|---|---|---|---|
| sb-<project>-auth-token (may be split into .0, .1) | Lixtara (Supabase Auth) | Keeps you signed in and protects account and listing actions. | Until you sign out or the session expires |
| lx_consent | Lixtara | Stores your choice in the cookie banner (accept or reject analytics and advertising, separately). | 365 days |
| lx_step1_form | Lixtara | Keeps the address and email you typed in step 1 of the listing flow if the submission fails or you sign in, so you don't lose them. | 30 minutes |
| lx_signup_email | Lixtara | Remembers the email you signed up with for the verification-code screen, without putting it in the page address. | 1 hour |
| lixtara_cookie_notice_dismissed (local storage) | Lixtara | Remembers that you closed the cookie notice, so it is not shown on every page. | Until you clear the site's data in your browser |

### 4. Analytics Cookies (only with your consent)

Only if you accept the Analytics category in the cookie banner, we use Google Analytics 4 (loaded through Google Tag Manager), to measure traffic and where visits come from, and Microsoft Clarity, to understand how pages are used through heatmaps and session recordings. If you reject, these tools are not activated. The events we send ourselves include page addresses without query parameters and never the text you type.

Clarity hides the text and data you type, and we also hide photos, documents and signatures. Your account area (/account) and payment, which Stripe processes on its own pages, are not recorded.

Microsoft no longer publishes the duration of Clarity's cookies; the durations in the table are approximate and are set by Microsoft.

| Name | Provider | Purpose | Duration |
|---|---|---|---|
| lx_ft | Lixtara | Stores which campaign or website first brought you here (UTM parameters, no personal data), to measure our campaigns. | 90 days |
| _ga | Google LLC (Google Analytics 4) | Distinguishes visitors for usage statistics. | Up to 2 years (set by Google) |
| _ga_<container-id> | Google LLC (Google Analytics 4) | Keeps the session state for usage statistics. | Up to 2 years (set by Google) |
| _clck | Microsoft (Clarity) | Clarity's pseudonymous user ID and preferences for this site. | About 1 year |
| _clsk | Microsoft (Clarity) | Connects the pages you view into a single session recording. | About 1 day |
| CLID | Microsoft (Clarity), on Microsoft domains | Identifies the first time Clarity saw this browser on any site that uses Clarity. | About 1 year |
| MUID | Microsoft, on Microsoft domains | Identifies browsers visiting Microsoft sites. Microsoft sets it on its own domains and uses it for its own purposes, described in its privacy statement. Lixtara does not use it. | About 1 year |
| ANONCHK | Microsoft, on Microsoft domains | Indicates whether MUID is transferred to another Microsoft cookie used for advertising; Clarity does not use it and the value is always 0. | About 10 minutes |
| MR | Microsoft, on Microsoft domains | Indicates whether to refresh MUID. | About 7 days |
| SM | Microsoft, on Microsoft domains | Synchronizes MUID across Microsoft domains. | Session (deleted when you close the browser) |

### 6. Advertising Cookies (only with your consent)

Only if you accept the Advertising category in the cookie banner, we activate, through Google Tag Manager, the Meta pixel (Meta Platforms, Inc.) and Google Ads conversion measurement (Google LLC). We use them to measure our campaigns (for example, whether a sign-up or a payment came from an ad) and to show you Lixtara ads on Facebook, Instagram, Google and other websites. If you reject this category, they are not activated and do not set these cookies. Lixtara does not show third-party advertising on its site.

Even if you have accepted it, advertising is not activated in the listing flow for your home, in your account, in sign-in and sign-up, or in your dashboard.

If your browser sends the Global Privacy Control signal, advertising stays rejected in that browser, even if you accept it in the banner (Privacy Policy, Section 9.1).

Meta and Google may also set cookies on their own domains and use them under their own privacy policies. The durations in the table are set by Meta and Google.

If you accept analytics, Microsoft may set cookies on its own domains (Section 4). Microsoft uses them under its own privacy statement; Lixtara does not use them for advertising.

| Name | Provider | Purpose | Duration |
|---|---|---|---|
| _fbp | Meta Platforms, Inc. | Identifies your browser to measure our Meta campaigns and show you Lixtara ads. | About 90 days (set by Meta) |
| _fbc | Meta Platforms, Inc. | Stores the click identifier when you arrive from a Meta ad (fbclid parameter), to attribute a sign-up or payment to that ad. | About 90 days (set by Meta) |
| _gcl_au | Google LLC (Google Ads) | Measures conversions (sign-ups and payments) from our Google Ads campaigns. | 90 days (set by Google) |
| _gcl_aw | Google LLC (Google Ads) | Stores the click identifier when you arrive from a Google ad (gclid parameter), to attribute a sign-up or payment to that ad. | 90 days (set by Google) |

### 8. How to Choose or Withdraw Consent

When you first visit Lixtara, the cookie banner lets you accept or reject analytics cookies and advertising cookies separately, with "Accept" and "Reject" equally visible for each category, as well as "Reject all" and "Accept all". Both categories stay rejected until you accept: no analytics or advertising is activated before that.

You can change your choice or withdraw your consent at any time through "Cookie settings" in the site footer. When you do, both categories return to rejected until you choose again; the tools in a category you reject stop being activated and the cookies they set on our domain are deleted from your browser. Cookies that Microsoft, Meta or Google set on their own domains can only be deleted from your browser.

- You can also view, block or delete cookies in your browser settings.
- If you block necessary cookies, you will not be able to sign in or use the listing flow.

## Política de Privacidad v4 (ES), secciones que cambian

### 4.6 Ausencia de Venta de Información Personal; Compartición y Publicidad Dirigida

Lixtara no vende su información personal por dinero.

Solo si usted acepta la categoría Publicidad en el aviso de cookies, compartimos identificadores en línea (como las cookies de Meta y de Google Ads) e información sobre su uso de nuestro sitio con Meta Platforms, Inc. y Google LLC para medir nuestras campañas y mostrarle anuncios de Lixtara en otros sitios y aplicaciones. Según algunas leyes estatales, esto puede considerarse "compartir" información para publicidad conductual de contexto cruzado o "publicidad dirigida". Si usted no acepta la publicidad, no compartimos su información para estos fines.

Puede negarse a esta compartición o detenerla en cualquier momento: rechace la categoría Publicidad en el aviso de cookies o retire su consentimiento en "Configurar cookies", en el pie del sitio. También puede escribirnos a privacy@lixtara.com.

### 6.2 Publicidad y Medición de Campañas

Usamos el píxel de Meta (Meta Platforms, Inc.) y Google Ads (Google LLC) para medir nuestras campañas de publicidad y mostrarle anuncios de Lixtara en otros sitios y aplicaciones. Solo funcionan si usted acepta la categoría Publicidad en el aviso de cookies; hasta entonces, y si la rechaza, no se activan. La publicidad nunca se activa en el proceso de publicación de su vivienda, en su cuenta, en el inicio de sesión y el registro, ni en su panel, aunque usted la haya aceptado.

Si su navegador envía la señal Global Privacy Control, la publicidad queda rechazada en ese navegador (Sección 9.1).

### 6.3 Cómo Retirar su Consentimiento a la Publicidad

Puede retirar su consentimiento en cualquier momento en "Configurar cookies", en el pie del sitio. A partir de ese momento, el píxel de Meta y Google Ads dejan de activarse y las cookies que pusieron en nuestro dominio se borran de su navegador. La información ya enviada la tratan Meta y Google según sus propias políticas: https://www.facebook.com/privacy/policy/ y https://policies.google.com/privacy

### 9.1 Residentes de California

Si usted es residente de California, la Ley de Privacidad del Consumidor de California (CCPA), en su versión modificada por la Ley de Derechos de Privacidad de California (CPRA), puede otorgarle ciertos derechos sobre su información personal, según si esa ley nos aplica. Estos pueden incluir el derecho a saber qué información personal recopilamos, usamos y divulgamos; el derecho a solicitar la eliminación de su información personal; el derecho a corregir información personal inexacta; el derecho a oponerse a la venta o la compartición de información personal; y el derecho a no ser discriminado por ejercer sus derechos.

Como se indica en la Sección 4.6, Lixtara no vende su información personal por dinero, y solo la comparte para publicidad conductual de contexto cruzado si usted acepta la categoría Publicidad en el aviso de cookies. Para oponerse a esa compartición, rechace esa categoría o retire su consentimiento en "Configurar cookies", en el pie del sitio. También tratamos la señal Global Privacy Control (GPC) como una solicitud de exclusión: si su navegador la envía, la categoría Publicidad queda rechazada en ese navegador, aunque la acepte en el aviso de cookies, y el aviso lo indica; la analítica no cambia. Para ejercer sus demás derechos en California, comuníquese con nosotros en privacy@lixtara.com.

### 4.1 (líneas nuevas)

- Google LLC (Google Ads): medición de nuestras campañas de publicidad y anuncios de Lixtara en otros sitios, solo si usted acepta las cookies de publicidad (consulte la Sección 6.2). Política de privacidad: https://policies.google.com/privacy
- Meta Platforms, Inc. (Meta pixel): medición de nuestras campañas de publicidad y anuncios de Lixtara en Facebook, Instagram y otras aplicaciones, solo si usted acepta las cookies de publicidad (consulte la Sección 6.2). Política de privacidad: https://www.facebook.com/privacy/policy/

## Política de Privacidad v4 (EN), secciones que cambian

### 4.6 No Sale of Personal Information; Sharing and Targeted Advertising

Lixtara does not sell your personal information for money.

Only if you accept the Advertising category in the cookie banner, we share online identifiers (such as the Meta and Google Ads cookies) and information about your use of our site with Meta Platforms, Inc. and Google LLC to measure our campaigns and show you Lixtara ads on other websites and apps. Under some state laws this may be considered "sharing" for cross-context behavioral advertising or "targeted advertising". If you do not accept advertising, we do not share your information for these purposes.

You can refuse or stop this sharing at any time: reject the Advertising category in the cookie banner, or withdraw your consent through "Cookie settings" in the site footer. You can also write to us at privacy@lixtara.com.

### 6.2 Advertising and Campaign Measurement

We use the Meta pixel (Meta Platforms, Inc.) and Google Ads (Google LLC) to measure our advertising campaigns and to show you Lixtara ads on other websites and apps. They run only if you accept the Advertising category in the cookie banner; until then, and if you reject it, they are not activated. Advertising is never activated in the listing flow for your home, in your account, in sign-in and sign-up, or in your dashboard, even if you have accepted it.

If your browser sends the Global Privacy Control signal, advertising stays rejected in that browser (Section 9.1).

### 6.3 Withdrawing Your Advertising Consent

You can withdraw your consent at any time through "Cookie settings" in the site footer. From then on, the Meta pixel and Google Ads are no longer activated and the cookies they set on our domain are deleted from your browser. Information already sent is processed by Meta and Google under their own policies: https://www.facebook.com/privacy/policy/ and https://policies.google.com/privacy

### 9.1 California Residents

If you are a California resident, the California Consumer Privacy Act (CCPA), as amended by the California Privacy Rights Act (CPRA), may give you certain rights regarding your personal information, depending on whether that law applies to us. These may include the right to know what personal information we collect, use, and disclose; the right to request deletion of your personal information; the right to correct inaccurate personal information; the right to opt out of the sale or sharing of personal information; and the right not to be discriminated against for exercising your rights.

As stated in Section 4.6, Lixtara does not sell your personal information for money, and shares it for cross-context behavioral advertising only if you accept the Advertising category in the cookie banner. To opt out of that sharing, reject that category or withdraw your consent through "Cookie settings" in the site footer. We also treat the Global Privacy Control (GPC) signal as a request to opt out: if your browser sends it, the Advertising category stays rejected in that browser, even if you accept it in the cookie banner, and the cookie banner says so; analytics is not affected. To exercise your other California rights, contact us at privacy@lixtara.com.

### 4.1 (líneas nuevas)

- Google LLC (Google Ads): measurement of our advertising campaigns and Lixtara ads on other websites, only if you accept advertising cookies (see Section 6.2). Privacy policy: https://policies.google.com/privacy
- Meta Platforms, Inc. (Meta pixel): measurement of our advertising campaigns and Lixtara ads on Facebook, Instagram and other apps, only if you accept advertising cookies (see Section 6.2). Privacy policy: https://www.facebook.com/privacy/policy/

