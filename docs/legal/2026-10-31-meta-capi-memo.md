# API de Conversiones de Meta: texto de Privacidad para aprobar

**Fecha:** 2026-10-31 · **PR:** `feat/meta-capi` (sobre #225) · **Estado:** borrador, **NO publicado**

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

## Texto propuesto

**§6.2.** Se mantiene el párrafo del píxel y se agrega uno nuevo después de la frase "Advertising is never activated in the listing flow…".

**EN**

> The Meta pixel and Google Ads are not activated on those pages. However, if you have accepted the Advertising category, our server notifies Meta Platforms, Inc. (through the Meta Conversions API) of three steps of your listing: when you verify your email to list your home, when you sign the listing agreement, and when you pay for your plan. With each notice we send your email address and your Lixtara user ID, both converted with a one-way hash (SHA-256) before they leave our servers, the Meta cookies in your browser (_fbp and _fbc), your IP address and your browser's user agent, and, for the payment, the plan and the amount paid. We never send your name, phone number, or the address or any other detail of your home or listing. Meta uses this information to measure our campaigns, to decide who sees our ads, and to avoid showing them to people who have already purchased a plan. To send the notices that happen without your browser (for example, when the signature or the payment is confirmed), we keep the Meta cookies, your IP address and your user agent on our servers. We delete your IP address and user agent 90 days after we save them or once your plan payment is confirmed, whichever comes first; we keep the Meta cookies while your account exists. We delete all of them if you withdraw your consent. If you do not accept advertising, or your browser sends the Global Privacy Control signal, we send nothing to Meta.

**ES (usted)**

> El píxel de Meta y Google Ads no se activan en esas páginas. Sin embargo, si usted aceptó la categoría Publicidad, nuestro servidor avisa a Meta Platforms, Inc. (mediante la API de Conversiones de Meta) de tres pasos de su listado: cuando verifica su correo para publicar su vivienda, cuando firma el contrato de listado y cuando paga su plan. Con cada aviso enviamos su correo electrónico y su identificador de usuario de Lixtara, ambos convertidos con un hash irreversible (SHA-256) antes de salir de nuestros servidores, las cookies de Meta de su navegador (_fbp y _fbc), su dirección IP y el agente de usuario de su navegador y, en el pago, el plan y el monto pagado. Nunca enviamos su nombre, su teléfono, ni la dirección u otro dato de su vivienda o de su listado. Meta usa esta información para medir nuestras campañas, decidir a quién se muestran nuestros anuncios y no mostrárselos a quien ya compró un plan. Para enviar los avisos que ocurren sin su navegador (por ejemplo, cuando se confirma la firma o el pago), guardamos en nuestros servidores las cookies de Meta, su dirección IP y su agente de usuario. Borramos su dirección IP y su agente de usuario 90 días después de guardarlos o cuando se confirma el pago de su plan, lo que ocurra primero; las cookies de Meta las conservamos mientras exista su cuenta. Si usted retira su consentimiento, borramos todo. Si usted no acepta la publicidad, o su navegador envía la señal Global Privacy Control, no enviamos nada a Meta.

**Otros ajustes de Privacidad v4 que hay que hacer en el mismo cambio:**

- **§4.6 (EN/ES):** después de "information about your use of our site", agregar "and, as described in Section 6.2, notices of the steps of your listing".
- **§6.3:**
  - EN: agregar "From then on, our server also stops notifying Meta and deletes the identifiers it kept for that purpose."
  - ES: agregar "A partir de ese momento, nuestro servidor también deja de avisar a Meta y borra los identificadores que guardaba para ello."
- **§4.1:** la línea del proveedor Meta (`PRIVACY_PROVIDERS`) suma "Conversions API" / "API de Conversiones".
- **Política de cookies:** sin cambios. La API de Conversiones no pone cookies; solo lee `_fbp` y `_fbc`, que ya están declaradas.
- **Versión:** sube de `2026-10-24-v4` a v5. Si #225 aún no se hubiera publicado, se puede integrar en la v4.

## Preguntas para el abogado

1. **"Sharing" según las leyes estatales.** ¿Basta §4.6 para el correo cifrado más la IP con fines de publicidad dirigida, o hace falta mencionar la API de Conversiones también en §9.1 (California)?
2. **Contradicción aparente.** ¿El texto que dice que la publicidad "nunca se activa" en esas páginas, seguido de "sin embargo, nuestro servidor avisa…", se lee como contradictorio? ¿Conviene reescribir la frase vigente?
3. **Conservación.** La IP y el navegador ya tienen plazo: 90 días o hasta el pago, lo primero. ¿Basta "mientras exista su cuenta" para `_fbp` y `_fbc`, o conviene también un plazo fijo?

## Para encenderla

1. Aprobar el texto (owner).
2. Publicar el texto: el PR que cambia `src/lib/legal/privacy.ts`, con nueva versión. El test `published-v2.test.ts` hoy exige que no aparezca la API de Conversiones y hay que actualizarlo.
3. Aplicar la migración `20261031120000_ad_attribution.sql` (owner, `supabase db push`).
4. Agregar las variables en Production: `META_CAPI_TOKEN`, `META_DATASET_ID` y `META_CAPI_ENABLED=true`. Nunca `META_TEST_EVENT_CODE`.
