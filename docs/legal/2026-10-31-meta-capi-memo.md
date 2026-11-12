# API de Conversiones de Meta: texto de Privacidad para aprobar

**Fecha:** 2026-10-31 · **PR:** #246 `feat/meta-capi` · **Estado:** **Privacidad v5 aprobada por el owner el 2026-11-11** (versión `2026-11-11-v5`). Se publica al mergear #246, junto con Cookies v5. Revisión del abogado pendiente (preguntas abajo).

## Qué cambia en el sitio

Decisión del owner del 2026-10-31, sobre el plan de medición del CMO (paso 4.8):

- **El píxel de Meta sigue sin cargar** en el registro de la vivienda, la cuenta, el acceso y registro, el panel y el admin (§6.2 vigente). Eso no cambia.
- **Nuestro servidor avisa a Meta** de tres hitos del registro del vendedor:
  - verificó su correo para publicar (`Lead`);
  - firmó el contrato de listado (`CompleteRegistration`);
  - pagó su plan (`Purchase`).
- **Solo con la categoría Publicidad aceptada** y sin Global Privacy Control. Sin eso no se envía nada: no hay versión anónima.
- **Datos que se envían en cada aviso:**
  - el correo y el identificador de usuario de Lixtara, cifrados con SHA-256;
  - las cookies `_fbp` y `_fbc` de Meta;
  - la IP y el navegador (user agent);
  - en el pago, el plan y el monto.
- **Datos que nunca se envían:** nombre, teléfono, dirección ni ningún dato de la vivienda o del listado.
- **Dónde se guardan:** IP, navegador, `_fbp` y `_fbc` quedan en Supabase (tabla `ad_attribution`, solo el servidor). Hacen falta porque la firma y el pago pueden llegar sin el navegador de la persona.
  - **La IP y el navegador se borran a los 90 días de guardarse o al confirmarse el pago del plan (después del aviso `Purchase`), lo que ocurra primero** (pedido del CMO, 2026-10-31). Un proceso diario borra los vencidos y, pasado el plazo, tampoco se envían aunque el proceso no haya corrido.
  - `_fbp`, `_fbc` y la elección quedan mientras exista la cuenta.
  - Si retira la Publicidad en "Configurar cookies", se borra todo y no sale ningún aviso más.
  - La fila se borra con la cuenta.
- **La función está apagada en producción** (`META_CAPI_ENABLED`) hasta que este texto esté aprobado y publicado.

## Texto aprobado (owner, 2026-11-11)

Está en `src/lib/legal/privacy.ts` y lo fija `published-v2.test.ts` ("Privacidad v5").

**§6.2.** Los párrafos 1 y 2 se reemplazan por estos dos. El párrafo de GPC queda igual, como tercero.

**EN**

> We use the Meta pixel (Meta Platforms, Inc.) and Google Ads (Google LLC) to measure our advertising campaigns and to show you Lixtara ads on other websites and apps. They run only if you accept the Advertising category in the cookie banner; until then, and if you reject it, they are not activated. The Meta pixel and Google Ads never load in the listing flow for your home, in your account, in sign-in and sign-up, or in your dashboard, even if you have accepted advertising.
>
> If you have accepted the Advertising category, our server (not your browser) notifies Meta Platforms, Inc., through the Meta Conversions API, of three steps: when you verify your email to create your account or list your home, when you sign the listing agreement, and when you pay for your plan. With each notice we send your email address and your Lixtara user ID, both converted with a one-way hash (SHA-256) before they leave our servers, the Meta cookies in your browser (_fbp and _fbc), your IP address and your browser's user agent, and, for the payment, the plan and the amount paid. We never send your name, phone number, or the address or any other detail of your home or listing. Meta uses this information to measure our campaigns, to decide who sees our ads, and to avoid showing them to people who have already purchased a plan. To send the notices that happen without your browser (for example, when the signature or the payment is confirmed), we keep the Meta cookies, your IP address and your user agent on our servers. We delete your IP address and user agent 90 days after we save them or once your plan payment is confirmed, whichever comes first; we keep the Meta cookies while your account exists. We delete all of them if you withdraw your consent. If you do not accept advertising, or your browser sends the Global Privacy Control signal, we send nothing to Meta.

**ES (usted)**

> Usamos el píxel de Meta (Meta Platforms, Inc.) y Google Ads (Google LLC) para medir nuestras campañas de publicidad y mostrarle anuncios de Lixtara en otros sitios y aplicaciones. Solo funcionan si usted acepta la categoría Publicidad en el aviso de cookies; hasta entonces, y si la rechaza, no se activan. El píxel de Meta y Google Ads nunca se cargan en el proceso de publicación de su vivienda, en su cuenta, en el inicio de sesión y el registro, ni en su panel, aunque usted haya aceptado la publicidad.
>
> Si usted aceptó la categoría Publicidad, nuestro servidor (no su navegador) avisa a Meta Platforms, Inc., mediante la API de Conversiones de Meta, de tres pasos: cuando verifica su correo al crear su cuenta o publicar su vivienda, cuando firma el contrato de listado y cuando paga su plan. Con cada aviso enviamos su correo electrónico y su identificador de usuario de Lixtara, ambos convertidos con un hash irreversible (SHA-256) antes de salir de nuestros servidores, las cookies de Meta de su navegador (_fbp y _fbc), su dirección IP y el agente de usuario de su navegador y, en el pago, el plan y el monto pagado. Nunca enviamos su nombre, su teléfono, ni la dirección u otro dato de su vivienda o de su listado. Meta usa esta información para medir nuestras campañas, decidir a quién se muestran nuestros anuncios y no mostrárselos a quien ya compró un plan. Para enviar los avisos que ocurren sin su navegador (por ejemplo, cuando se confirma la firma o el pago), guardamos en nuestros servidores las cookies de Meta, su dirección IP y su agente de usuario. Borramos su dirección IP y su agente de usuario 90 días después de guardarlos o cuando se confirma el pago de su plan, lo que ocurra primero; las cookies de Meta las conservamos mientras exista su cuenta. Si usted retira su consentimiento, borramos todo. Si usted no acepta la publicidad, o su navegador envía la señal Global Privacy Control, no enviamos nada a Meta.

**Otros ajustes de Privacidad v5 (aprobados):**

- **§4.1:** la línea de Meta dice "Meta Platforms, Inc. (Meta pixel and Conversions API)" en EN y "Meta Platforms, Inc. (píxel de Meta y API de Conversiones)" en ES (`name_es` en `providers.ts`).
- **§4.6:** después de "information about your use of our site" se agrega "and, as described in Section 6.2, notices of the steps of your listing". En ES, "y, según se describe en la Sección 6.2, avisos de los pasos de su listado".
- **§6.3:** después de la frase del borrado de cookies se agrega:
  - EN: "Our server also stops notifying Meta and deletes the identifiers it kept for that purpose."
  - ES: "Nuestro servidor también deja de avisar a Meta y borra los identificadores que guardaba para ello."
- **Versión:** Privacidad pasa a `2026-11-11-v5` ("Última actualización" 2026-11-11). La casilla del registro se registra como `terms-2026-10-21-v3+privacy-2026-11-11-v5`, con el mismo texto y hash. La versión anterior (`…+privacy-2026-10-24-v4`) queda en el historial.
- **Política de cookies v5 (`2026-11-02-v5`): NO está publicada** (corrección del 2026-11-11). Solo existe en la rama de #246: en `main` y en lixtara.com sigue la v4 (`2026-10-24-v4`). Sale con el merge de #246, junto con Privacidad v5. La API de Conversiones no pone cookies; solo lee `_fbp` y `_fbc`, que ya están declaradas. Lo que cambia en la v5:
  - **`lx_ft`:** además de las UTM (con Analítica), guarda los identificadores de clic de Google Ads de la URL de llegada (`gclid`, `gbraid`, `wbraid`), solo con Publicidad aceptada y sin GPC, y se borran si se rechaza la Publicidad. Texto de la fila (sin GTM no hay Publicidad y la fila dice solo UTM):
    - EN: "Stores which campaign or website first brought you here (UTM parameters, only if you accept analytics) and, only if you accept advertising, the Google Ads click identifier from the link you arrived on (gclid, gbraid or wbraid), to measure our campaigns and attribute a sign-up or payment to that ad. If you reject a category, its part is deleted."
    - ES: "Guarda de qué campaña o sitio llegó por primera vez (parámetros UTM, solo si acepta la analítica) y, solo si acepta la publicidad, el identificador del clic de Google Ads del enlace con el que llegó (gclid, gbraid o wbraid), para medir nuestras campañas y atribuir el registro o el pago a ese anuncio. Si rechaza una categoría, se borra su parte."
  - **`_gcl_gb` (2026-11-04):** fila en Publicidad junto a `_gcl_au` y `_gcl_aw` (90 días según la página de cookies publicitarias de Google). Texto: "Guarda el identificador del clic que Google usa en lugar de gclid en algunos casos, por ejemplo en iPhone (parámetro gbraid), cuando llega desde un anuncio de Google, para atribuir el registro o el pago a ese anuncio." / "Stores the click identifier Google uses instead of gclid in some cases, for example on iPhone (gbraid parameter), when you arrive from a Google ad, to attribute a sign-up or payment to that ad."
  - Su "Última actualización" dirá 2026-11-02, la fecha de la decisión, aunque se publique después.

## Preguntas para el abogado

1. **"Sharing" según las leyes estatales.** ¿Basta §4.6 para el correo cifrado más la IP con fines de publicidad dirigida, o hace falta mencionar la API de Conversiones también en §9.1 (California)?
2. **Contradicción aparente.** ¿El texto que dice que la publicidad "nunca se activa" en esas páginas, seguido de "sin embargo, nuestro servidor avisa…", se lee como contradictorio? ¿Conviene reescribir la frase vigente?
3. **Conservación.** La IP y el navegador ya tienen plazo: 90 días o hasta el pago, lo primero. ¿Basta "mientras exista su cuenta" para `_fbp` y `_fbc`, o conviene también un plazo fijo?

## Para encenderla

1. ~~Aprobar el texto (owner).~~ Aprobado el 2026-11-11.
2. Publicar el texto: está en #246 (`privacy.ts`, versión `2026-11-11-v5`, tests actualizados). Se publica al mergear #246.
3. Aplicar la migración `20261031120000_ad_attribution.sql` (owner, `supabase db push`).
4. Agregar las variables en Production: `META_CAPI_TOKEN`, `META_DATASET_ID` y `META_CAPI_ENABLED=true`. Nunca `META_TEST_EVENT_CODE`.
