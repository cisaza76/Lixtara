# Términos v3: memo para el abogado

**Para:** abogado de Lixtara LLC
**Fecha:** 2026-10-21
**Estado:** decisiones de la broker (Anamaria) y del owner, 2026-10-21. Los cuatro cambios están **pendientes de revisión** del abogado. Se publican cuando el owner mergee el PR, igual que la v2.

- Memo anterior: `2026-10-18-textos-v2-memo.md`. Sus puntos B3 (cuándo se debe la comisión, período de protección) y B6 (coherencia con la terminación del ERS-21tn) se relacionan con este memo; el cambio 4 reemplaza el cambio 1 de la v2 (§16 y el Early Termination Addendum).
- Fuente única de los números: `src/config/listing-agreement.ts` (`PROTECTION_PERIOD_DAYS`) y `src/lib/pricing-tiers.ts` (tarifa fija de cada plan). Ningún texto los escribe a mano.

## Qué cambia

| Documento | Ruta | Versión | Base |
|---|---|---|---|
| Términos de Servicio | `/terms` | 2026-10-21-v3 | v2 + cambios 2 y 4 |
| Casilla del paso 8 (`terms_refund`) | paso 8 | 2026-10-21-v3 | v2 + cambio 3 |
| Casilla de registro (`terms`) | `/sign-up`, paso 7 | terms-2026-10-21-v3+privacy-2026-10-18-v2 | mismo texto que la v2: cambia solo la versión de los Términos que se acepta |
| Privacidad, Cookies, Avisos legales, Avisos de corretaje, Accesibilidad | — | 2026-10-18-v2 | sin cambios |

Las aceptaciones ya registradas conservan su versión y su texto: las v1 y v2 de las dos casillas se siguen reconstruyendo con su hash (`src/lib/legal/consents.ts`).

## Los cuatro cambios (pendientes de revisión)

1. **Período de protección: 90 días, en la línea 123 del acuerdo de listado.** — *Pendiente de revisión.*
   - **Antes:** la v2 de los Términos (§16) citaba un "Early Termination Addendum" que nunca se redactó; la nota del 2026-10-17 lo dejaba pendiente del abogado. No había ningún texto publicado con 60 días.
   - **Ahora:** no hay anexo. El período de protección vive en la línea 123 del ERS-21tn: "within 90 days after Termination Date ('Protection Period')", llenada desde `PROTECTION_PERIOD_DAYS` (PR #217). La terminación anticipada es la del párrafo 12 del mismo acuerdo (Conditional Termination), ver cambio 4.
   - **Para el abogado:** confirmar el plazo. El registro de visitas y ofertas del lado comprador (`property_buyer_contacts`, aprobado con 60 días y sin empezar) debe usar la misma constante.
2. **Términos §6 (y la política de reembolso del sitio): cancelación después de publicar en el MLS.** — *Pendiente de revisión.*
   - **Antes (EN):** "…You get a full refund if the broker doesn't approve your listing or it can't be published, if you were charged twice or because of a technical error, or if you cancel before it's published."
   - **Ahora (EN, Términos y sitio):** se agrega "If you cancel after it's published on the MLS, the cancellation fee in your listing agreement equals the flat fee you already paid for your plan ($199 Essentials, $495 Pro, $995 Concierge) and is deemed paid by it: you pay nothing additional."
   - **Ahora (ES, Términos, con usted):** "Si usted cancela después de que su propiedad esté publicada en el MLS, la tarifa de cancelación de su acuerdo de listado es igual a la tarifa fija que usted ya pagó por su plan ($199 Essentials, $495 Pro, $995 Concierge) y se considera pagada con ella: no se le cobra ningún monto adicional."
   - **Ahora (ES, sitio, con tú):** "Si cancelas después de que esté publicada en el MLS, la tarifa de cancelación de tu acuerdo de listado es igual a la tarifa fija que ya pagaste por tu plan ($199 Essentials, $495 Pro, $995 Concierge) y se considera pagada con ella: no pagas nada adicional."
   - La tarifa fija sigue sin reembolsarse una vez publicada; antes de publicar, el reembolso sigue siendo total (y en los demás casos de reembolso total). La misma política la leen la FAQ, el paso 8, Loui y los correos (`src/config/legal-terms.ts#refundPolicy`, v3).
   - **Coherencia con el contrato:** el párrafo 15 del ERS-21tn (PR #217) dice: "The cancellation fee in Paragraph 12 equals the fixed fee Seller already paid and is deemed satisfied by that payment; no additional amount is due. If Seller cancels before MLS publication, Seller receives a full refund as stated in Lixtara's Terms of Service, Section 6." La línea 207 lleva la tarifa fija del plan.
   - **Resuelto (owner):** la tarifa de cancelación **no** se suma a la tarifa fija: es la misma tarifa ya pagada y no se cobra nada adicional.
   - **Para el abogado:** el párrafo 12 del ERS-21tn dice "pay a cancellation fee of $___ plus applicable sales tax"; los Términos no mencionan el impuesto. ¿Hay que decir algo sobre el impuesto sobre la venta?
3. **Casilla del paso 8 (checkout).** — *Pendiente de revisión.*
   - **Antes (EN):** "I understand that the {fee} flat fee is charged whether or not my home sells and is non-refundable once my home is published on the MLS. If my listing ends before publication, I receive a full refund. The {pct} commission is due only if a sale closes."
   - **Ahora (EN):** "…If my listing ends before publication, I receive a full refund. If I cancel after publication, the cancellation fee in my listing agreement equals the {fee} flat fee I already paid and is deemed paid by it; I pay nothing additional. The {pct} commission is due only if a sale closes."
   - **Ahora (ES):** "…Si mi listado termina antes de la publicación, recibo el reembolso total. Si cancelo después de la publicación, la tarifa de cancelación de mi acuerdo de listado es igual a la tarifa fija de {fee} que ya pagué y se considera pagada con ella; no pago nada adicional. La comisión del {pct} solo se paga si la venta se cierra."
   - `{fee}` y `{pct}` son los del plan elegido (`pricing-tiers.ts`).
4. **Términos §16: el párrafo 12 del acuerdo de listado en lugar del anexo.** — *Pendiente de revisión.*
   - **Antes (EN):** "…You may close your account by contacting us at support@lixtara.com, subject to your signed listing agreement and its Early Termination Addendum."
   - **Antes (ES):** "…sujeto a lo que establezcan su acuerdo de listado firmado y su Anexo de Terminación Anticipada (Early Termination Addendum)."
   - **Ahora (EN):** "…You may close your account by contacting us at support@lixtara.com, subject to your signed listing agreement, including its Paragraph 12 (Conditional Termination)."
   - **Ahora (ES):** "…sujeto a lo que establezca su acuerdo de listado firmado, incluido su párrafo 12 (Conditional Termination, terminación condicional)."
   - Ningún otro texto del sitio (diccionario, FAQ, Loui) citaba el anexo.
