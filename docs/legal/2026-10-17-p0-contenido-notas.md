# P0 de contenido (2026-10-17): notas para el memo legal y para el equipo

**Estado:** BORRADOR. Cambios de contenido sin decisiones legales nuevas.
**Para el memo:** cuando el #203 se rebase sobre `main`, la sección "Reembolso" de abajo se mueve a `docs/legal/memo-revision-2026-10-16.md` (ítems 9 y 20 de su tabla), y este archivo se borra.

## Reembolso en los Términos: alineada con la política publicada; pendiente de revisión legal

La política vigente es `refundPolicy` (`src/config/legal-terms.ts`). La aprobó el owner, y ya la muestran las FAQ, Loui, el recibo y la casilla del paso 8. Los Términos §6 ahora la leen de esa misma fuente. "Last updated" de los Términos: 2026-10-17 (`TERMS_LAST_UPDATED`).

| | Texto anterior (Términos §6) | Contradicción | Texto nuevo |
|---|---|---|---|
| EN | "The flat plan fee is non-refundable. Except where a refund is required by applicable law, all fees paid to Lixtara are non-refundable, and we do not provide refunds or credits for partially used terms, unused features, or listings that do not result in a sale." | Las FAQ y Loui prometen el reembolso total si la broker no aprueba el listado o no se puede publicar, si hubo un cobro duplicado o un error técnico, o si se cancela antes de la publicación. Los Términos decían que nada se reembolsa. | "The flat fee is non-refundable once your property is published on the MLS. You get a full refund if the broker doesn't approve your listing or it can't be published, if you were charged twice or because of a technical error, or if you cancel before it's published." |
| ES | "La tarifa fija del plan no es reembolsable. Salvo cuando la ley aplicable exija un reembolso, todas las tarifas pagadas a Lixtara no son reembolsables, y no otorgamos reembolsos ni créditos por plazos utilizados parcialmente, funciones no utilizadas o publicaciones que no resulten en una venta." | La misma. | "La tarifa fija no se reembolsa una vez tu propiedad está publicada en el MLS. Te devolvemos el total si la broker no aprueba tu listado o no se puede publicar, si te cobramos dos veces o por un error técnico, o si cancelas antes de la publicación." |
| EN/ES | "Add-on fees are **also** non-refundable except where required by law." / "…**tampoco** son reembolsables…" | El "también" remitía a la regla anterior. | Se quitó solo el "also" / "tampoco". La regla de los extras no cambia. |

Preguntas para el abogado:
1. Ya no aparece "Except where a refund is required by applicable law" para la tarifa fija, porque la política publicada no la incluye. ¿Hace falta mantener esa salvedad?
2. La política está escrita con **tú**, y el resto de los Términos con **usted**. ¿Se unifica el registro?
3. ¿Es coherente con la cláusula de terminación del ERS-21tn? (ítem 9 del memo)

## Términos, ronda 2 (2026-10-18): compensación, nombre legal, dirección y "la broker"

"Last updated" de los Términos: 2026-10-18 (`TERMS_LAST_UPDATED`).

### §4.1: compensación al agente del comprador

El §4.1 ahora muestra `buyerAgentComp.summary` (`src/config/legal-terms.ts`), la misma fuente que leen la FAQ y Loui. El tope de 3% por política de Lixtara (`BUYER_COMP_MAX_PCT`, `src/lib/buyer-comp.ts`) ya regía en el paso 6 desde el #206, pero ningún texto lo mencionaba. Ahora el texto lo dice (`buyerAgentComp.cap`), y la FAQ "¿Tengo que ofrecer compensación…?" también. La definición sube a la **versión 2** (2026-10-18): las ofertas nuevas se guardan con `buyer_agent_comp@2`, y las anteriores conservan `@1`.

| | Texto anterior (Términos §4.1) | Problema | Texto nuevo |
|---|---|---|---|
| EN | "…This buyer-agent commission is typically in the range of 2% to 3% and is your decision, except that under the Concierge plan the cooperating commission is set at 3%. The cooperating commission you offer is in addition to the Lixtara plan fee and the Lixtara seller-side commission…" | Concierge no fija el 3% (es un punto de partida que el vendedor cambia). "Typically 2% to 3%" sugiere una tarifa normal, y no decía que 0% está permitido ni que la oferta no va al MLS. "Commission" no es el término del glosario. | "Buyer's agent compensation is separate from the Lixtara commission. You decide whether to offer it and how much, and 0% is allowed. By Lixtara policy, it can be up to 3%: as a percentage of the sale price, or as a fixed amount of up to 3% of the list price. Since 2024, MLS rules don't allow it to be published on the MLS, so if you offer it we share it directly with the agents who ask for it. Within that limit it's negotiable, isn't set by law, and is put in writing." |
| ES | "…suele estar en el rango del 2% al 3% y es su decisión, salvo que bajo el plan Concierge la comisión cooperante se fija en 3%…" | El mismo. | "La compensación al agente del comprador es aparte de la comisión de Lixtara. Tú decides si la ofreces y cuánto, y puedes ofrecer 0%. Por política de Lixtara, puede ser de hasta 3%: como porcentaje del precio de venta, o como monto fijo de hasta el 3% del precio de lista. Desde 2024, por las reglas del MLS, no se publica en el MLS: si la ofreces, la comunicamos directamente a los agentes que la soliciten. Dentro de ese límite es negociable, no la fija la ley y se formaliza por escrito." |

Cambios relacionados en la misma versión:
- Antes decía "fully negotiable" / "100% negociable". Ahora dice "Within that limit it's negotiable" / "Dentro de ese límite es negociable", porque el tope lo limita. El texto exacto del paso 6 (`stepBody`, "Es 100% negociable") no cambió: es el texto aprobado y su test lo fija.
- §3 y §6 decían "cooperating (buyer-agent) commission" / "comisión cooperante". Ahora dicen "compensation to the buyer's agent" / "compensación al agente del comprador", y el §6 remite a la Sección 4.1 ("is separate from these amounts and is your decision; it can be 0%").

### Nombre legal y dirección

- La introducción decía "operated by Lixtara" / "operada por Lixtara". Ahora dice **"Lixtara LLC"**.
- El §21 decía "Lixtara, Miami, Florida" sin dirección. Ahora dice "Lixtara LLC, 181 Vera Ct, Miami, FL 33143, United States".
- El número de licencia CQ (§3, §4, §21), el nombre de la broker (§4, §21) y su licencia BK (§21, nueva) se leen de `src/config/brokerage.ts`. El DBPR muestra a Lixtara LLC en esa dirección (comprobado el 2026-10-18).

### "La broker"

- En los Términos ES, "Nuestra corredora principal a cargo" (§4) y "Corredora principal a cargo" (§21) pasan a "La broker a cargo, Anamaria Velasquez".
- "Un corredor de bienes raíces con licencia" (introducción) pasa a "un broker de bienes raíces con licencia".
- En el sitio, los 17 "el/del broker" que se referían a ella pasan a "la broker" / "de la broker". Por ejemplo: "Cola de la broker", "Esperando revisión de la broker", "supervisado por la broker principal de Lixtara" y los bullets de los planes.
- Nueva regla del glosario, `theBroker`: en español no se permite "el/del/al broker". "Un broker" y "tu broker" sí.
- El test del glosario ahora recorre también los Términos del Servicio.

**Fuera de este PR:** la Política de Privacidad y los Avisos Legales todavía dicen "operated by Lixtara" / "operada por Lixtara". Los Avisos dicen además "corredora principal a cargo" y "apoyo de corredor", y su español no lleva tildes. Quedan para el #203, junto con el tú/usted de los Términos ES (§4.1 y §6 usan tú porque leen de `legal-terms.ts`).

### Enlace al DBPR

Cambió la búsqueda general (`wl11.asp`) por la ficha directa de cada licencia: CQ1075352 (inicio y About) y BK3664191 (insignia de la broker en el inicio). Las dos se abren sin sesión. Comprobado el 2026-10-18.

Preguntas para el abogado (§4.1):
4. ¿El tope de 3% "por política de Lixtara" necesita más contexto o una salvedad? Por ejemplo, que el comprador puede negociar con su agente aparte.
5. ¿Está bien "Within that limit it's negotiable" / "Dentro de ese límite es negociable", o se dice de otra forma?

## Cancelación

Se quitaron "Cancel anytime" / "Cancela cuando quieras" de los tres planes.

La FAQ "What if my home doesn't sell?" / "¿Qué pasa si mi casa no se vende?" ahora dice:
- **EN:** "Your listing has a defined expiration date of up to 24 months. If you want to end it early, contact us and we'll explain the terms of your listing agreement."
- **ES:** "Tu listado tiene una fecha de vencimiento definida, de hasta 24 meses. Si quieres terminarlo antes, contáctanos y te explicamos las condiciones de tu acuerdo de listado."

Pendiente del abogado: el anexo de terminación anticipada, con período de protección.

## Bullets de los planes que dependen de personal

Todos se mantienen. El equipo debe confirmar quién responde por cada uno.

| Plan | Bullet (EN, `src/lib/i18n.ts` → `pricing.tiers`) | ¿Quién responde? |
|---|---|---|
| Todos | "Showing scheduling integration" (agendamiento de visitas) | |
| Essentials | "Email support" | |
| Essentials / Pro | "Realtor consultation: $150/hr (pay per use)" | |
| Essentials | "Lockbox + yard sign: $60 add-on when vacant" | |
| Pro / Concierge | "MLS listing with a broker-reviewed description…" | |
| Pro | "Professional photography (… value, included)" | |
| Pro | "Broker compliance & strategy call (30 min)" | |
| Pro | "Dedicated listing coordinator" | |
| Pro | "Lockbox + yard sign included when vacant" | |
| Pro | "Email + chat support" | |
| Concierge | "Premium photography + drone shots" | |
| Concierge | "Dedicated broker, 7 days a week" | |
| Concierge | "Full negotiation assistance" | |
| Concierge | "Transaction management through closing" | |
| Concierge | "Unlimited Realtor consultations included" | |
| Concierge | "Lockbox + yard sign installation included" | |
| Concierge | "Staging consultation" | |
| Concierge | "Open house coordination" | |
| Concierge | "Weekly market updates" (reportes semanales) | |
| Concierge | "Phone, email + chat support" | |

También dependen del equipo, fuera de los planes:
- Sección de compradores: el equipo busca, agenda visitas, ayuda con la oferta y acompaña hasta el cierre.
- Contacto: respuesta "within one business day" / "en máximo un día hábil".

## "Realtor"

Se mantiene donde ya estaba: bullets de los planes, FAQ y testimonios ("my realtor"). En `/about` no se agregó "Realtor".

**Confirmado por la broker (2026-10-18):** Anamaria y las personas descritas como "Realtor" son miembros activos de NAR. "Realtor" se queda.

## Concierge: la broker dedicada (2026-10-18)

Decisión de la broker: Concierge lo atiende Anamaria.
- **EN:** "a dedicated broker" pasa a "your dedicated broker, Anamaria Velasquez".
- **ES:** "un broker dedicado" pasa a "la broker dedicada, Anamaria Velasquez".
- El nombre sale de `src/config/brokerage.ts` (`{brokerName}`). `fillTierCopy` ahora también reemplaza los datos de la correduría.

Dónde aparece:
- El bullet del plan Concierge ("Your dedicated broker, … 7 days a week" / "La broker dedicada, … 7 días a la semana").
- El paso 4 de "Cómo funciona".
- El "por qué" del quiz.
- La FAQ "¿Qué plan…?".
- Loui, que lee los bullets y la FAQ.

En "no incluido" del plan Pro, el bullet "Dedicated broker and full negotiation assistance" / "Broker dedicada y asistencia completa en negociación" no lleva el nombre. Si lo llevara, parecería que Pro no tiene acceso a ella, y Pro sí incluye una llamada con la broker.

Los Términos no mencionan a un broker dedicado. El glosario ya no permite "broker dedicado" en español.
