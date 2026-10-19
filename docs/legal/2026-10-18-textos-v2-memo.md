# Textos legales v2 publicados: memo para el abogado

**Para:** abogado de Lixtara LLC
**Fecha:** 2026-10-18
**Estado:** **PUBLICADOS** en lixtara.com por decisión del owner, **antes** de la revisión del abogado. Este memo deja constancia de qué se decidió sin él, para que lo revise después.

- Paquete en PDF, generado desde el mismo código que publica el sitio: `docs/legal/paquete-abogado-2026-10/` (`pnpm legal:package`).
- Memos anteriores:
  - `2026-10-18-textos-v1-memo.md` (v1);
  - `memo-revision-2026-10-16.md` (borrador del #203). La numeración de las marcas de ese borrador es la que se usa abajo.

## Qué se publicó

| Documento | Ruta | Versión | Base |
|---|---|---|---|
| Términos de Servicio | `/terms` | 2026-10-18-v2 | v1 (#210) + cambios 1–2 |
| Política de Privacidad | `/privacy` | 2026-10-18-v2 | v1 (#210) + cambio 4 + §4.1 desde la lista de proveedores, §5 y §9.1 (ver tabla) |
| Política de Cookies | `/cookies` | 2026-10-18-v2 | borrador del #203, con tablas y la variante según la analítica configurada |
| Avisos Legales (Disclaimers) | `/disclaimers` | 2026-10-18-v2 | borrador del #203 (IDX, valuaciones, registros públicos, IA) |
| Avisos de corretaje, vivienda justa y fraude | `/notices` | 2026-10-18-v2 | borrador del #203 (página nueva) |
| Declaración de accesibilidad | `/accessibility` | 2026-10-18-v2 | borrador del #203 (página nueva) |
| DMCA | `/dmca` | 2026-09-02-v1 | sin cambios |

Cada página muestra su versión y su fecha. El pie de página enlaza las siete páginas, muestra "© {año} Lixtara LLC", agrega "Licensed Real Estate Brokerage" en móvil y enlaza "Equal Housing Opportunity" a `/notices#fair-housing`.

## Los cinco cambios pedidos por el owner

1. **Términos §16.**
   - **Antes:** "…subject to any obligations that survive under a signed listing agreement, including a 24-month listing term and any commission obligations."
   - **Ahora:** "…You may close your account by contacting us at support@lixtara.com, subject to your signed listing agreement and its Early Termination Addendum."
   - **ES:** "…sujeto a lo que establezcan su acuerdo de listado firmado y su Anexo de Terminación Anticipada (Early Termination Addendum)."
   - **Nota:** se reemplazó la frase entera "subject to any obligations… commission obligations". El reemplazo literal habría dejado "subject to" dos veces seguidas.
2. **Términos, final de §14 (Limitación de responsabilidad) y §15 (Indemnización).**
   - **EN:** "This does not apply to fraud, gross negligence, willful misconduct, or duties that cannot be limited under Florida law."
   - **ES:** "Esto no se aplica al fraude, la negligencia grave, la conducta dolosa ni a los deberes que no pueden limitarse conforme a la ley de Florida."
3. **Casilla de registro (`/sign-up` y paso 7).**
   - **EN:** "I agree to the Terms of Service, including the arbitration agreement in Section 17, and the Privacy Policy."
   - **ES:** "Acepto los Términos de servicio, incluido el acuerdo de arbitraje de la Sección 17, y la Política de privacidad."
   - **Enlaces:** `/terms`, `/terms#section-17` y `/privacy`. Cada sección numerada de los Términos tiene el ancla `#section-N`.
4. **Privacidad §2.3.** Se agregó el texto del owner sobre registros públicos y proveedores de datos (property tax roll de Florida, Sunbiz y proveedores comerciales de correos). Incluye la baja en cualquier momento. En ES, con usted.
5. **Aviso E-SIGN (paso 7).** "at any time before signing" → "at any time". En ES: "en cualquier momento antes de firmar" → "en cualquier momento".

## Versiones y pruebas de aceptación

- **Versión nueva.** Términos y Privacidad pasan a `2026-10-18-v2`. Las casillas tienen versión nueva:
  - `terms`: `terms-2026-10-18-v2+privacy-2026-10-18-v2`;
  - `terms_refund`: `2026-10-18-v2`;
  - `esign`: `2026-10-18-v2`.
- **Hashes.** Se regeneraron los SHA-256 de las casillas v2.
- **Aceptaciones anteriores.** Se quedan con la v1. El texto v1 de cada casilla se conserva en el código (`previous` en `src/lib/legal/consents.ts`). Una prueba reconstruye cada versión registrada, v1 y v2, y compara su hash, así que la prueba de una aceptación v1 sigue verificable.
- **Casilla de reembolso (paso 8).** El texto no cambió, así que el hash de la v2 es el mismo que el de la v1. Cambia la versión de los Términos que se acepta.
- **Migraciones.** No hizo falta ninguna. `terms_acceptances.version` es texto de hasta 64 caracteres; la versión más larga tiene 41.

## Coherencia

- **Términos en español con usted.** La §6 usaba el texto de reembolso del sitio, que va con tú. Ahora usa `refundPolicyTerms`: la misma política v2, con usted, en `src/config/legal-terms.ts`. Una prueba compara las dos versiones.
- **Nada escrito a mano en los Términos.**
  - Precios, porcentajes y plazo de 24 meses: de `pricing-tiers.ts`. La §6 los tenía escritos a mano.
  - "Lixtara LLC": de `brokerage.ts`.
  - Reembolso y compensación: de `legal-terms.ts`.
  - Correos: de `brokerage.ts`.
- **Avisos de corretaje §4.** La compensación al agente del comprador es el mismo texto de los Términos §4.1 (`legal-terms.ts`, v3).
- **Cookies.**
  - "No usamos cookies de publicidad" se mantiene en el aviso y en todas las variantes de la política, mientras Clarity esté pausado.
  - La tabla de cookies necesarias lista las cookies reales del código, más la clave de almacenamiento local del aviso de cookies.

## Tabla de marcas [VERIFICAR]

Ninguna marca queda en las páginas públicas; una prueba lo exige en todas las variantes y en los dos idiomas.

Criterio de cada resolución:
- redacción más conservadora posible;
- sin afirmar que cumplimos una ley;
- sin prometer plazos, canales ni servicios que no existen;
- si la frase no era necesaria, se eliminó.

Las marcas que aparecían en EN y ES van en una sola fila.

### A. Documentos que se publican desde el borrador del #203

| # | Dónde | Qué decía la marca | Qué quedó publicado | Por qué |
|---|---|---|---|---|
| A1 | Cookies, tabla, sesión de Supabase | Duración "Up to 400 days" sin confirmar | "Until you sign out or the session expires" | No se pudo confirmar la duración efectiva. Se describe sin número. |
| A2 | Cookies, tabla, `_ga` | Duración de 2 años sin confirmar | "Up to 2 years (set by Google)" | El máximo se atribuye a Google; no se promete un valor exacto. |
| A3 | Cookies, tabla, `_ga_<id>` | Igual que A2 | "Up to 2 years (set by Google)" | Igual que A2. |
| A4 | Cookies, tabla, `MUID` | Uso publicitario de Microsoft frente a "No usamos cookies de publicidad" | "Microsoft sets it on its own domains and uses it for its own purposes, described in its privacy statement. Lixtara does not use it." | Hecho cierto que no niega lo que dice Microsoft ni lo repite como nuestro. La frase de publicidad se mantiene, por instrucción del owner, mientras Clarity esté pausado. |
| A5 | Cookies, tabla, PostHog | Duración sin confirmar | "About 1 year (set by PostHog)" | Se atribuye a PostHog. |
| A6 | Cookies §6 (Publicidad), variante con GTM | Confirmar si "No usamos cookies de publicidad" puede quedar así con el MUID | "If you accept analytics, Microsoft may set cookies on its own domains (Section 4). Microsoft uses them under its own privacy statement; Lixtara does not use them for advertising." | Describe lo que hacemos nosotros, sin afirmar nada sobre Microsoft. **Para el abogado:** si Clarity se reactiva, revisar si esto cuenta como "compartir" para publicidad. |
| A7 | Cookies §7, Turnstile | Si Turnstile pone cookies y cuáles | "Cloudflare may set the cookies it needs for that check." | Sin enumerar cookies que no verificamos. |
| A8 | Disclaimers §3 (IDX) | Texto oficial y ubicación del aviso IDX, copyright en ES, fecha de actualización | Se quitó la marca. "When the Services show listings from other brokerages…"; los avisos se describen como lo que el sitio muestra (`display-compliance.ts`), no como "lo que exige el MLS" | Hoy no se muestran fichas del MLS. Se evita afirmar que cumplimos las reglas IDX. **Para el abogado:** sigue abierto antes de activar MLS_DISPLAY. |
| A9 | Avisos §1 | Redacción de la Regla 61J2-10.025 en toda publicidad | Queda solo "\"Lixtara\" is the brand under which Lixtara LLC offers its services." Se quitó la frase que decía que en toda publicidad y correo nos identificamos con el nombre registrado | No podemos afirmarlo para todo canal (Instantly, redes). **Para el abogado:** sigue abierto. |
| A10 | Avisos §2.1 | Qué divulgación del §475.278 aplica a cada flujo y cuándo se entrega | "The type of brokerage relationship… are those stated in the written agreement you sign with us, such as the listing agreement." Se eliminó "Unless that agreement says otherwise, Lixtara LLC works with sellers as a transaction broker" y la mención al acuerdo de compradores | No afirmamos un tipo de relación ni un formulario que no está definido. **Riesgo alto, sigue abierto** (punto 1 del memo del #203). |
| A11 | Avisos §3 | Si el vendedor puede negociar en la práctica la tarifa o el porcentaje | Se eliminó "You are free to negotiate different terms with us". Queda "Commissions are negotiable and are not set by law." y "You are free to work with any other brokerage." | No prometemos una negociación que el proceso no ofrece. |
| A12 | Avisos §4 | Reglas de MIAMI/SEFMLS para comunicar la compensación fuera del MLS | La sección usa el texto de los Términos §4.1 (`legal-terms.ts`, v3) y una frase general sobre los acuerdos de los compradores con su agente. Se eliminó "Lixtara does not condition the listing… on whether the seller offers compensation" | Una sola fuente para la compensación; nada que no diga la política v3. |
| A13 | Avisos §5 | Categorías protegidas por ordenanzas locales | "…or any other characteristic protected by federal, state or local law, including local ordinances such as those of Miami-Dade County." | Sin enumerar categorías que no verificamos. |
| A14 | Avisos §5.1 | Teléfonos y canales vigentes de HUD, FCHR y Miami-Dade | "You may also file a complaint with the U.S. Department of Housing and Urban Development (HUD) or with the Florida Commission on Human Relations." Sin teléfonos ni sitios web | No publicamos datos de contacto sin verificar. |
| A15 | Avisos §6 | Si Lixtara recibe depósitos en garantía | Se quitó la marca. Queda "We charge our plan fees only through the secure checkout on our website." | Es cierto (Stripe). No decimos nada sobre escrow. |
| A16 | Avisos §7 (RESPA) | Si existe algún acuerdo comercial afiliado | Se eliminó el párrafo que prometía la divulgación AfBA. Queda: el cliente elige sus proveedores y usar uno que mencionemos nunca es condición | Sin prometer un procedimiento que no existe. Desde #204 Lixtara no vende servicios legales. |
| A17 | Accesibilidad §4 | Que exista accessibility@lixtara.com | Solo support@lixtara.com y la dirección postal | El buzón no está confirmado. |
| A18 | Accesibilidad §4.1 | Plazo de respuesta (2 días hábiles) | "We will reply by email and work with you to provide the information, or complete the task you need, another way." | Sin plazo. |
| A19 | Accesibilidad §4.1 | Canales alternativos reales (teléfono, cita) | Solo correo electrónico | Es el único canal confirmado. Además: §2 dice "we aim to" en vez de "we do"; §5 ya no promete una revisión anual. |
| A20 | Configuración (`ACCESSIBILITY_EMAIL`) | Que el buzón exista | Constante eliminada | Ver A17. |
| A21 | `src/config/publication.ts` | Plazo de publicación de 2 días hábiles, sin confirmar por el owner | El plazo vive en `src/config/legal-terms.ts` (`PUBLICATION_BUSINESS_DAYS = 2`), decisión del owner del 2026-10-17 (#205) | Ya resuelto en main. |
| A22 | Pie de página, logo EHO dibujado en SVG | Si cumple la guía de HUD (24 CFR 110) | No se publica el logo dibujado. Queda el texto "Equal Housing Opportunity" con enlace a `/notices#fair-housing` | Sin arte no oficial. |
| A23 | Proveedores, Upstash | Enlace a su política | https://upstash.com/trust/privacy.pdf | Responde (verificado el 2026-10-18). |
| A24 | Proveedores, Rentcast | Razón social | Solo "Rentcast" | No se pudo verificar la razón social. |
| A25 | Proveedores, Rentcast | Enlace | https://www.rentcast.io/privacy | El enlace del borrador daba 404; este responde. |
| A26 | Proveedores, Luma | Enlace | https://lumalabs.ai/legal/privacy | Responde. |
| A27 | Proveedores, Instantly | Razón social | Solo "Instantly" | No verificada. |
| A28 | Proveedores, Instantly | Enlace | https://instantly.ai/privacy | Responde. |
| A29 | Proveedores, Bridge/MIAMI (MLS) | Enlace | Sin enlace | El sitio bloquea la verificación automática (403). |
| A30 | Proveedores, Miami-Dade | Enlace | Sin enlace | El enlace del borrador daba 404. |
| A31 | Aviso E-SIGN, comentario del código | Contenido mínimo de §7001(c) y §668.50 | Comentario retirado; el texto pasa a v2 con el cambio 5 | El aviso no afirma cumplir esas normas. **Para el abogado:** revisarlo sigue pendiente. |

En la lista de proveedores tampoco se publica ninguna otra razón social: solo el nombre comercial de cada proveedor. La lista ahora incluye los que faltaban en la v1: Sentry, Instantly, el MLS, Gemini y PostHog.

### B. Borrador de Términos y Privacidad del #203: no se publica

Los Términos y la Privacidad publicados son la v1 del #210 con los cambios de este memo. El borrador del #203 de esos dos documentos no se publica, así que sus marcas no llegan al sitio. Para cada una se indica cómo trata el tema la v2.

| # | Marca del borrador | Cómo lo trata la v2 publicada | ¿Abierto? |
|---|---|---|---|
| B1 | Términos, intro: mecanismo de aceptación | Casilla obligatoria con enlaces en `/sign-up` y paso 7, registrada en `terms_acceptances` (cambio 3) | Resuelto |
| B2 | Términos §3: alcance de "dedicated broker, 7 days a week" y consultas ilimitadas | Los Términos no describen las prestaciones de cada plan; la §6 solo da tarifa, porcentaje y plazo | Sí: es copy del sitio, no de los Términos |
| B3 | Términos §3: cuándo se debe la comisión (plazo, período de protección) | §6.1: "applies to a qualifying sale of the property as set out in your listing agreement" | Sí, revisar contra el ERS-21tn |
| B4 | Términos §3: quién presta la consulta legal | §3: "We do not provide legal advice", más el aviso de servicios legales bajo los Términos (#204: Lixtara no vende ni incluye servicios legales) | Resuelto por #204 |
| B5 | Términos §4.1: plazo para procesar reembolsos | La política v2 (`legal-terms.ts`) no promete plazo | Sí |
| B6 | Términos §4.1: coherencia con la cláusula de terminación del ERS-21tn | §16 remite al acuerdo de listado y a su Early Termination Addendum (cambio 1) | Revisar el anexo |
| B7 | Términos §4.1: reembolso de extras, consultas y staging | §6 (v1): "Add-on fees are non-refundable except where required by law." | **Sí: revisar**, porque es una decisión publicada sin el abogado |
| B8 | Términos §5: plazo de publicación | Los Términos no lo mencionan; el sitio usa `publicationTimeline` (2 días hábiles, decisión del owner) | Resuelto |
| B9 | Términos §7: forma y momento del aviso de relación de corretaje | §4: la relación nace del acuerdo de listado y las divulgaciones que se firman | Sí (ver A10) |
| B10 | Términos §7: cómo se documenta la oferta de compensación | §4.1 con la política v3: Lixtara "will communicate and document offers… of up to 3%" | Sí: punto 5 del memo v1 (base del 3%) |
| B11 | Términos §7: 3% fijo de Concierge | La v3 no tiene porcentaje fijo; el paso 6 lo muestra como "punto de partida sugerido" | Resuelto |
| B12 | Términos §8: atestación de titularidad | §7 y §11: el vendedor declara que tiene derecho a publicar; el flujo no pide documentos | Sí |
| B13 | Términos §8: deber de revelación (Johnson v. Davis) | §4: "required disclosures of known material defects… under Florida law" | Sí |
| B14 | Términos §15: exigibilidad del tope de responsabilidad | §14 con la frase del cambio 2 | Revisar |
| B15 | Términos §16: alcance razonable de la indemnización | §15 (v1, más amplia que el borrador: incluye "your use of the Services" y disputas con terceros) con la frase del cambio 2 | **Sí: revisar el alcance** |
| B16 | Términos §17: arbitraje (proveedor, reglas, opt-out) | §17 del owner: AAA Consumer Arbitration Rules, opt-out de 30 días por correo a legal@, sin arbitraje masivo | Revisar |
| B17 | Privacidad §2.3: fuente de los correos de prospección | Texto del owner (cambio 4) | Revisar los contratos con los proveedores de datos |
| B18 | Privacidad §2.4/§8: conservación de las pruebas de consentimiento | §7.1 (v1): cinco años después de que termine la relación | Sí: punto 1 del memo v1 (purga) |
| B19 | Privacidad §3.1: bases jurídicas | No se incluyen; la política es para EE. UU. | No |
| B20 | Privacidad §4.6: MUID y "compartir" para publicidad | §4.6 (v1): "We do not currently share… for cross-context behavioral advertising"; Cookies, ver A4 y A6 | Sí, si Clarity se reactiva |
| B21 | Privacidad §5: Loui envía a Anthropic el nombre y las notas del comprador | **Cambio de la v2:** §5 lo dice: "If you are a seller and ask Loui about offers on your listing, the details of those offers, which may include the buyer's name and notes, are also sent to Anthropic" | Divulgado; decidir si se deja de enviar |
| B22 | Privacidad §7: CAN-SPAM y ley de Florida para correos a propietarios | No se afirma cumplimiento; §2.3: "You can unsubscribe at any time" | Sí |
| B23 | Privacidad §7: TCPA y FTSA si se activan SMS o llamadas | No hay SMS ni llamadas automatizadas; la casilla `calls_sms` sigue sin mostrarse | Sí, antes de activarlos |
| B24 | Privacidad §8: conservación de registros del corredor (Cap. 475 / 61J2-14) | §7: plazos generales, sin cifras | Sí |
| B25 | Privacidad §8: plazos de borradores, registros del servidor y analítica | §7: sin cifras | Sí |
| B26 | Privacidad §9: alcance de §501.171 y plazos de aviso | §8: medidas razonables, sin promesa de plazos de notificación | Sí |
| B27 | Privacidad §10: si aplican la CCPA/CPRA y la Florida Digital Bill of Rights | **Cambio de la v2:** §9.1 dice que la CCPA "may give you certain rights… depending on whether that law applies to us" (antes "provides you with"); §9.2 ya decía "may" | Revisar umbrales |

## Lo que queda abierto (prioridad para el abogado)

1. **Relación de corretaje (A10, B9).** Qué divulgación del §475.278 aplica a cada flujo y cuándo se entrega.
2. **Reembolso de extras (B7) y alcance de la indemnización (B15).** Son textos de la v1 que ahora están publicados.
3. **Arbitraje (B16) y casilla de registro (cambio 3).** Las cuentas creadas antes de hoy aceptaron la v1, sin mención expresa de la §17.
4. **IDX (A8)** antes de activar la visualización del MLS, y **Regla 61J2-10.025 (A9)** en los correos de prospección.
5. **Retención de las pruebas de consentimiento** (punto 1 del memo v1) y **base del 3%** (punto 5 del memo v1).
