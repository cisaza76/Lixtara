> **Histórico (2026-10-18).** Borrador del #203, conservado como referencia de la numeración de sus marcas. Lo publicado y cómo se resolvió cada marca: `2026-10-18-textos-v2-memo.md`.

# Memo de revisión legal: borradores de octubre de 2026

**Para:** abogado de Lixtara LLC
**De:** equipo de producto (borrador asistido)
**Fecha:** 2026-10-16
**Estado:** BORRADOR. Nada de lo que sigue es texto final ni afirma que Lixtara cumpla una ley específica.

**Alcance.** Términos, Privacidad, Cookies, Disclaimers, Avisos de corretaje / vivienda justa / fraude (`/notices`), Accesibilidad, avisos dentro del flujo y coherencia de todo el sitio. Cada `[VERIFICAR: …]` también aparece dentro del texto del documento, en la sección indicada.

**Datos usados.**
- Licencias y dirección: `src/config/brokerage.ts`.
- Precios y plazos: `src/lib/pricing-tiers.ts`.
- Configuración única de fechas, versiones y marcadores: `src/lib/legal/config.ts`.

## Los 5 puntos más riesgosos

1. **Relación de corretaje (§475.278 F.S.).** El sitio no entrega ninguna divulgación de *transaction broker* / *single agent* / *no brokerage relationship* en solicitudes de visita, ofertas, consultas pagadas ni en las llamadas de estrategia que agenda Loui. Solo remite al listing agreement. Riesgo **alto** (disciplinario ante FREC).
   - Recomendación: definir qué formulario corresponde a cada flujo y en qué momento se entrega, antes de la primera interacción sustantiva.
2. **Compensación al agente del comprador.** Ya corregí la FAQ y el resto del sitio para que digan que no se publica en el MLS.
   - **El paso 6 sigue diciendo** "Listing rules require you to publish what you'll pay a co-operating broker" (i18n `listingForm.step6.buyerCommissionBody`). Lo dejé así a propósito: es el texto congelado hasta que la broker lo apruebe.
   - El "3% fijo" de Concierge tampoco está aprobado.
   - Riesgo **alto**: hoy el texto del paso 6 contradice los Términos (§7) y la práctica posterior al acuerdo de NAR de 2024.
3. **Investor Club.** Promete "Priority bidding on Lixtara-listed homes", "Listings 48 hours before they go live on the MLS" y "Off-market inventory shared with members first" (i18n 1632-1647). Puede chocar con los deberes hacia el vendedor y con Clear Cooperation (MIAMI/SEFMLS). Riesgo **alto**.
   - Recomendación: retirar esas promesas hasta revisarlas. No las cambié porque son una decisión de negocio.
4. **Consultas con abogado vendidas por Lixtara.** El precio es $450/h y Concierge dice "unlimited Realtor and attorney consultations". No hay identificación del abogado ni aclaración de que Lixtara no es un bufete, y no se sabe si hay reparto de honorarios ni si existe un *affiliated business arrangement* (RESPA). Riesgo **alto**.
   - Recomendación: aclarar la relación con el abogado. Si existe un beneficio, preparar la divulgación AfBA antes de seguir vendiéndolas.
5. **Aceptación de los Términos.** Este PR agrega dos aceptaciones con prueba (`terms_acceptances`):
   - la casilla de reembolso del paso 8;
   - el consentimiento E-SIGN del paso 7.

   No hay aceptación expresa de los Términos al crear la cuenta: sign-up solo muestra texto sin enlace y el paso 1 y el paso 7 no muestran nada. Riesgo **alto**: hoy la exigibilidad de los Términos, incluidos el arbitraje y el tope de responsabilidad, es débil.
   - Recomendación: casilla con enlace al crear la cuenta, registrada en `terms_acceptances` con un documento nuevo, por ejemplo `terms`.

Siguen de cerca:
- `MUID` de Microsoft frente a "No usamos cookies de publicidad" (#6);
- el arbitraje y la renuncia a acciones colectivas (#17);
- la fuente de los correos de prospección (#22).

## Tabla de [VERIFICAR]

| # | Documento | Sección | Pregunta concreta | Riesgo | Recomendación |
|---|---|---|---|---|---|
| 1 | Avisos | `relationship` 2.1 | ¿Qué divulgación del §475.278 aplica a cada flujo (listing, visita, oferta desde el sitio, consulta pagada) y en qué forma y momento se entrega? | alto | Definir un formulario por flujo y entregarlo antes de mostrar la propiedad o al firmar. |
| 2 | Términos | §7 | ¿Cómo se documenta la compensación al agente del comprador (addendum, contraoferta)? ¿Está aprobado el 3% fijo de Concierge? | alto | Que lo defina la broker y cambiar el texto del paso 6 en un PR aparte. |
| 3 | Avisos | `buyer-compensation` | ¿Cómo permiten hoy las reglas de MIAMI REALTORS / SEFMLS comunicar la compensación fuera del MLS? | alto | Revisar las reglas vigentes y alinear el formulario del listing. |
| 4 | Marketing (i18n) | Investor Club | ¿Pueden sostenerse las pujas prioritarias, el acceso 48 h antes del MLS y el inventario off-market? | alto | Retirarlas hasta revisarlas. |
| 5 | Términos / Avisos | §3 consultas / `respa` | ¿Quién presta la consulta legal? ¿Hay reparto de honorarios o un AfBA (RESPA)? ¿Hay una compañía de títulos con beneficio? | alto | Aclarar la relación y, si aplica, preparar la divulgación AfBA. |
| 6 | Cookies / Privacidad / Aviso | Tabla MUID, §4.6, banner | ¿Contradice `MUID` de Microsoft (que Microsoft dice usar "for advertising") la frase "No usamos cookies de publicidad"? ¿Cuenta como "compartir" para publicidad conductual? | alto | Decidirlo. Opciones: matizar la frase, o configurar Clarity sin cookies de Microsoft si se puede. |
| 7 | Términos | Intro | ¿Cómo se aceptan los Términos? | alto | Casilla con enlace al crear la cuenta, registrada en `terms_acceptances`. |
| 8 | Términos | §3 comisión | ¿Cuándo se debe la comisión: venta dentro del plazo, período de protección del ERS-21tn? | alto | Copiar el mecanismo exacto del listing agreement. |
| 9 | Términos | §4.1 | ¿Es coherente la política de reembolso con la cláusula de terminación del ERS-21tn? | alto | Revisar el formulario firmado contra la política. |
| 10 | Términos / config | §5, `src/config/publication.ts` | El plazo de publicación es **2 días hábiles** después de la contrafirma. Es la propuesta de la instrucción; el owner aún no lo confirmó. | alto | Que el owner lo confirme. El sitio, Loui, el recibo y los Términos lo leen de una sola constante. |
| 11 | Términos | §8 | Declaración de titularidad (homestead, copropietarios, poderes): ¿qué se pide y con qué documentos? El flujo hoy no pide nada. | alto | Agregar una casilla en el paso 1 o el 3 y registrarla en `terms_acceptances`. |
| 12 | Disclaimers | `idx` | ¿Cuál es el texto oficial y la ubicación del aviso IDX (reglas de MIAMI REALTORS, Anexos de SEFMLS)? ¿Se exige el copyright en ES (hoy solo EN) y la fecha de actualización? | alto | Contrastar con el contrato de licencia de datos. |
| 13 | Avisos | `brokerage` | ¿El nombre registrado aparece en toda publicidad según la Regla 61J2-10.025, incluidos los correos de Instantly y las redes? | alto | Aplicar la línea de licencia también en el pie de los correos de prospección. |
| 14 | Privacidad | §7 | Si se activan SMS o llamadas automatizadas: TCPA y FTSA (§501.059). | alto (al activarlo) | No activarlos sin el consentimiento escrito separado (`calls_sms`, borrador en `src/lib/legal/consents.ts`). |
| 15 | Consentimientos | `calls_sms` | Texto de la casilla de llamadas y SMS: identificación del vendedor, tecnología automatizada, STOP/HELP, frecuencia, que no es condición de compra. | alto | Revisar el borrador. Hoy no está conectado a ningún formulario (ver la sección "Formularios con teléfono"). |
| 16 | Términos | §5 / marketing | Pro se vendía con "priority MLS listing (48h)". Lo cambié por el plazo único. ¿Qué queda de "prioridad" en Pro? | medio | Que el owner defina la diferencia real entre planes o la quite. |
| 17 | Términos | §17 | ¿Conviene el arbitraje con renuncia a acciones colectivas en un servicio regulado? ¿Con qué proveedor (AAA o JAMS), qué reglas de consumo y qué opt-out de 30 días? | alto | Por defecto, tribunales de Miami-Dade más menor cuantía; arbitraje solo si el abogado lo aprueba. |
| 18 | Términos | §15 / §16 | ¿Son exigibles frente a consumidores el tope de responsabilidad y la indemnización, considerando los deberes del licenciatario? | medio | Revisar y mantenerlos acotados. |
| 19 | Términos | §3 Concierge | ¿Qué alcance tienen "dedicated broker 7 days a week" y las consultas "ilimitadas"? | medio | Definir el alcance o quitarlo del marketing. |
| 20 | Términos | §4.1 | Plazo para procesar reembolsos (propuesta: 10 días hábiles). ¿Se reembolsan los extras, las consultas y el staging? | medio | Que el owner lo defina. |
| 21 | Términos | §8 | Redacción del deber de revelación (Johnson v. Davis) y formularios que se usan. | medio | Que el abogado la ajuste. |
| 22 | Privacidad | §2.3 | Fuente de los correos de prospección (proveedor, licencia, base para usarlos). | alto | Documentarlo antes de enviar correos a propietarios. |
| 23 | Privacidad | §5 | Loui envía a Anthropic el **nombre y las notas del comprador** de las ofertas que lee para el vendedor. | medio | Quitar `buyer_name` y `notes` de lo que lee Loui (`src/app/api/loui/route.ts`) o mantener la divulgación. |
| 24 | Privacidad / BD | §2.4, §8 / migración | Plazo de conservación de las pruebas de consentimiento. La tabla conserva la fila (con el usuario o la propiedad en NULL) aunque se borre la cuenta. ¿Es compatible con una solicitud de borrado? | medio | Conservar al menos 5 años (prescripción de TCPA y contracargos) y decirlo en la política. |
| 25 | Privacidad | §8 | Conservación de registros del corredor (Cap. 475 / 61J2-14) y plazos de borradores abandonados, servidor y analítica. | medio | Confirmar los mínimos (propuesta: 5 años para registros; 24 y 13 meses para lo demás). |
| 26 | Privacidad | §9 | Alcance de "personal information" en la §501.171 y plazos de aviso de incidentes. | medio | Confirmar el alcance y los 30 días. |
| 27 | Privacidad | §10 | ¿Aplican la CCPA/CPRA, la Florida Digital Bill of Rights u otras leyes según los umbrales? | medio | No afirmar cumplimiento; revisar los umbrales cada año. |
| 28 | Privacidad | §7 | Requisitos de CAN-SPAM y de la ley de Florida para los correos a propietarios. | medio | Confirmar el pie y la gestión de bajas. Los correos comerciales del sitio siguen bloqueados (`BROKERAGE_LEGAL_NAME` y `BROKERAGE_POSTAL_ADDRESS` vacíos en `src/lib/broker.ts`). |
| 29 | Consentimientos | `esign` | ¿Cumple el aviso con el contenido mínimo de la §7001(c) del E-SIGN Act y la §668.50 de la UETA de Florida (copia en papel, retiro, hardware y software, actualización del correo)? | medio | Revisar el aviso; se muestra y registra antes de abrir DocuSign. |
| 30 | Avisos | `fair-housing` | Categorías protegidas por ordenanzas locales (Miami-Dade: orientación sexual, identidad de género, fuente de ingresos, edad, estado civil). | medio | Enumerarlas o remitir a la ordenanza. |
| 31 | Pie de página | Logo EHO | ¿El logotipo dibujado en SVG cumple la guía de HUD (24 CFR Part 110) o se usa el arte oficial? | bajo | Reemplazarlo por el arte oficial si hace falta. |
| 32 | Avisos | `wire-fraud` | ¿Recibe Lixtara depósitos en garantía (escrow) u otros fondos? | medio | Si no, mantener la frase. |
| 33 | Avisos | `commissions` | ¿El vendedor puede negociar en la práctica la tarifa o el porcentaje del plan? | medio | Alinear la frase con el proceso real. |
| 34 | Accesibilidad | `report` | ¿Existe el buzón accessibility@lixtara.com? ¿Qué canales alternativos son reales? ¿En qué plazo se responde? | medio | Confirmar el buzón y fijar el plazo (propuesta: 2 días hábiles). |
| 35 | DMCA | Agente | ¿Está vigente el registro DMCA-1080195 en el directorio de la Copyright Office? | medio | Verificar en el directorio público. |
| 36 | DMCA | Agente | La dirección dice "Coral Gables" y el resto del sitio "Miami" (33143). El nombre es "Lixtara, LLC" en vez de "Lixtara LLC". Las etiquetas de la página en ES siguen en inglés. | bajo / medio | Que coincida con lo registrado; si cambia, actualizar el registro. |
| 37 | Cookies | Tablas | Duraciones de la sesión de Supabase, de GA4 (`_ga` y `_ga_<id>`), de PostHog y de las cookies de Turnstile. | bajo | Confirmarlas en la configuración y la documentación de cada proveedor. |
| 38 | Proveedores | `providers.ts` | Razón social y enlace de privacidad de Rentcast, Instantly, Upstash, Luma, Bridge y Miami-Dade. | bajo | Confirmarlos en los contratos. |
| 39 | Marketing (i18n) | `valueProps[1]` | "We handle contracts, disclosures, and the legal mechanics" puede sugerir servicios legales. | medio | Redactarlo como servicios de corretaje. |
| 40 | Ofertas | Formulario de oferta | No dice que la oferta no es vinculante ni que no es un contrato FAR/BAR. | medio | Agregar un aviso corto antes de enviarla. |

## Formularios con teléfono (Tarea 2.7)

| Formulario | Archivo | ¿Tiene casilla de llamadas o SMS? |
|---|---|---|
| Registro (`/sign-up`) | `src/app/[lang]/sign-up/page.tsx` | **Falta.** Solo dice "Used for showings + agent contact". |
| Contacto | `src/app/[lang]/contact/page.tsx` | **Falta** (teléfono opcional, sin aviso ni enlace a Privacidad). |
| Mi cuenta (perfil) | `src/app/[lang]/account/page.tsx` | **Falta.** |
| Solicitud de visita | `src/components/showing-request-form.tsx` | Sí, en borrador (`CONSENT_VERSION = "2026-10-draft-2"`). Le falta identificar al vendedor, decir si se usa tecnología automatizada e incluir STOP/HELP. |
| Paso 3, "mostrar mi teléfono en portales" | `src/app/[lang]/listing/new/page.tsx` | No es un consentimiento de contacto; es la publicación del teléfono. Conviene aclararlo. |

El borrador de la casilla está en `src/lib/legal/consents.ts` (`calls_sms`), versionado y con su hash fijado, pero **no lo conecté** a ningún formulario hasta que el abogado lo apruebe. Hoy no se envían SMS.

## Qué cambia este PR fuera de los documentos

- **Casilla del paso 8.** Es obligatoria antes de pagar el plan y enlaza a `/terms#refunds`.
  - El servidor rechaza el pago sin la casilla (400) o con una versión vieja de los Términos (409).
  - Registra la aceptación en `terms_acceptances` con la sesión de Stripe, el idioma, la versión, el hash del texto, la IP y el user agent.
  - Si no queda registrada, cierra la sesión de Stripe y no deja pagar (503).
  - La versión de los Términos también viaja en la metadata de Stripe.
- **Aviso E-SIGN del paso 7.** Va antes de abrir DocuSign, con una casilla obligatoria. Se registra igual que la del paso 8, y sin registro no se abre DocuSign.
- **Recibo de pago.** Agrega el reembolso resumido, el plazo de publicación y el enlace a `/terms#refunds`.
- **Pie de página.**
  - Enlaces a las 7 páginas legales.
  - Línea de licencia, más "Licensed Real Estate Brokerage" en móvil.
  - "© {año} Lixtara LLC".
  - Equal Housing Opportunity con logo, que enlaza a `/notices#fair-housing`.
- **Coherencia del copy.**
  - Quité "Cancel anytime".
  - Cambié "48h" y "48 horas" por el plazo único.
  - La FAQ de compensación ya no dice que se publica en el MLS.
  - La FAQ de "si no se vende" quedó alineada con el reembolso; ya no dice "sin penalidad" ni "el plazo más largo".
  - El correo de aprobación ya no promete "en unas horas".
  - En contacto en ES, "en máximo" pasó a "normalmente".
  - Loui ya no se atribuye licencias ni un doctorado, y repite el plazo y el reembolso de los Términos.
- **Migración (sin aplicar).** `supabase/migrations/20261017120000_terms_acceptances.sql` y su rollback. El owner la aplica antes del merge.
