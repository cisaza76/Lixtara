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

Se mantiene donde ya estaba: bullets de los planes, FAQ y testimonios ("my realtor"). Antes del merge, la broker confirma que las personas descritas así son miembros activos de NAR. Si alguna no lo es, para esa persona se usa "licensed agent" / "agente licenciado". En `/about` no se agregó "Realtor".
