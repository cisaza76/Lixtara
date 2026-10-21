# Términos v3: memo para el abogado

**Para:** abogado de Lixtara LLC
**Fecha:** 2026-10-21
**Estado:** modelo final del owner y de la broker (Anamaria), 2026-10-21. Los cambios de texto están **pendientes de revisión** del abogado. Se publican cuando el owner mergee el PR, igual que la v2.

- Memo anterior: `2026-10-18-textos-v2-memo.md`. Este memo trata sus puntos B3 (cuándo se debe la comisión, período de protección) y B6 (coherencia con la terminación del ERS-21tn), y reemplaza su cambio 1 (§16 y el Early Termination Addendum).
- Fuente única de los números:
  - `src/config/listing-agreement.ts`: `PROTECTION_PERIOD_DAYS` = 90 y `PROTECTION_NOTICE_DAYS` = 10;
  - `src/lib/pricing-tiers.ts`: tarifa fija y comisión de cada plan.
  
  Ningún texto escribe esos números a mano.

## El modelo

1. **Tarifa fija del plan.**
   - Se cobra en el checkout de Stripe, antes de publicar.
   - Reembolso total si la broker no aprueba el listado o si no se publica.
   - No hay reembolso una vez publicada en el MLS.
2. **Comisión del plan** (0.5 %, 1 % o 1.5 %, según `pricing-tiers.ts`).
   - Solo si la venta se cierra, y se paga al cierre.
   - Nunca se cobra por adelantado por una venta que no ocurrió.
3. **Terminación.**
   - El vendedor puede terminar el acuerdo en cualquier momento, sin costo.
   - No hay tarifa de cancelación.
4. **Período de protección.**
   - Dura 90 días después de la terminación.
   - Solo cubre a compradores que visitaron la propiedad o hicieron una oferta por escrito durante el acuerdo, y cuyos nombres Lixtara le entregó al vendedor por escrito dentro de los 10 días siguientes a la terminación.

En el contrato, el párrafo 15 del ERS-21tn (PR #217) dice lo mismo y prevalece sobre las cláusulas impresas:

> "(1) Flat Fee. Seller pays Broker a flat fee of ${fee} at checkout, before publication. It is earned and non-refundable upon first publication of the Property on the MLS, whether or not the Property sells. Seller receives a full refund if Broker does not approve the listing or the Property is not published on the MLS for any other reason. (2) Commission. The Paragraph 8(a) percentage is due only if a sale of the Property closes; the sentence "closing is not a prerequisite for Broker's fee being earned" and Paragraph 8(d)(2) do not apply. (3) Termination. Seller may terminate this Agreement at any time by written notice to Broker. Paragraph 12 does not apply, and no cancellation fee, expense reimbursement or other amount is due. (4) Protection Period. Paragraph 8(d)(3) applies only to buyers who toured the Property or made a written offer during this Agreement and whose names Broker delivers to Seller in writing within 10 days after termination. (5) This Paragraph 15 controls over any conflicting provision of this Agreement and over Lixtara's Terms of Service."

## Qué cambia

| Documento | Ruta | Versión | Base |
|---|---|---|---|
| Términos de Servicio | `/terms` | 2026-10-21-v3 | v2 + cambios 1 y 3 |
| Casilla del paso 8 (`terms_refund`) | paso 8 | 2026-10-21-v3 | v2 + cambio 2 |
| Casilla de registro (`terms`) | `/sign-up`, paso 7 | terms-2026-10-21-v3+privacy-2026-10-18-v2 | mismo texto que la v2: cambia solo la versión de los Términos que se acepta |
| Privacidad, Cookies, Avisos legales, Avisos de corretaje, Accesibilidad | — | 2026-10-18-v2 | sin cambios |

Las aceptaciones ya registradas conservan su versión y su texto: las v1 y v2 de las dos casillas se siguen reconstruyendo con su hash (`src/lib/legal/consents.ts`).

## Los cambios (pendientes de revisión)

1. **Términos §6 y la política de reembolso del sitio** (`src/config/legal-terms.ts#refundPolicy`, v3). — *Pendiente de revisión.*
   - **Antes (EN):** "The flat fee is charged whether or not your home sells. The flat fee is non-refundable once your property is published on the MLS. You get a full refund if the broker doesn't approve your listing or it can't be published, if you were charged twice or because of a technical error, or if you cancel before it's published."
   - **Ahora (EN, Términos y sitio):** se agrega "You can end your listing agreement at any time, at no charge. The Lixtara commission is due only if a sale closes, and it's paid at closing."
   - **Ahora (ES, Términos, con usted):** se agrega "Usted puede terminar su acuerdo de listado en cualquier momento, sin costo. La comisión de Lixtara solo se adeuda si la venta se cierra, y se paga al cierre."
   - **Ahora (ES, sitio, con tú):** se agrega "Puedes terminar tu acuerdo de listado en cualquier momento, sin costo. La comisión de Lixtara solo se paga si la venta se cierra, al momento del cierre."
   - La FAQ, el paso 8, Loui y los correos leen el mismo texto. Ningún texto habla de una tarifa de cancelación.
2. **Casilla del paso 8 (checkout).** — *Pendiente de revisión.*
   - **Antes (EN):** "I understand that the {fee} flat fee is charged whether or not my home sells and is non-refundable once my home is published on the MLS. If my listing ends before publication, I receive a full refund. The {pct} commission is due only if a sale closes."
   - **Ahora (EN):** "…If my listing ends before publication, I receive a full refund. I can end my listing agreement at any time, at no charge. The {pct} commission is due only if a sale closes, and it's paid at closing."
   - **Ahora (ES):** "…Si mi listado termina antes de la publicación, recibo el reembolso total. Puedo terminar mi acuerdo de listado en cualquier momento, sin costo. La comisión del {pct} solo se paga si la venta se cierra, al momento del cierre."
3. **Términos §16: el párrafo 15 del acuerdo de listado y el período de protección.** — *Pendiente de revisión.*
   - **Antes (EN):** "…You may close your account by contacting us at support@lixtara.com, subject to your signed listing agreement and its Early Termination Addendum."
   - **Antes (ES):** "…sujeto a lo que establezcan su acuerdo de listado firmado y su Anexo de Terminación Anticipada (Early Termination Addendum)."
   - **Ahora (EN):** "…subject to your signed listing agreement, including its Paragraph 15 (Additional Terms)." Se agrega un párrafo: "You may terminate your listing agreement at any time, at no charge, by written notice to the broker. After it ends, the seller-side commission is due only if, within 90 days, you sell or agree to sell the property to a buyer who toured it or made a written offer during the agreement and whose name Lixtara delivered to you in writing within 10 days after the agreement ended, and only if that sale closes."
   - **Ahora (ES):** "…sujeto a lo que establezca su acuerdo de listado firmado, incluido su párrafo 15 (Additional Terms, términos adicionales)." Se agrega un párrafo: "Usted puede terminar su acuerdo de listado en cualquier momento, sin costo, mediante aviso por escrito a la broker. Después de su terminación, la comisión del lado del vendedor solo se adeuda si, dentro de los 90 días siguientes, usted vende o acuerda vender la propiedad a un comprador que la visitó o hizo una oferta por escrito durante el acuerdo y cuyo nombre Lixtara le entregó por escrito dentro de los 10 días siguientes a la terminación, y solo si esa venta se cierra."
   - No hay anexo de terminación anticipada. El período de protección vive en la línea 123 del ERS-21tn (`PROTECTION_PERIOD_DAYS`) y en el párrafo 15(4).
4. **Textos del sitio alineados con el modelo** (con tú, EN/ES). — *Pendiente de revisión.*
   - **FAQ "¿Y si mi casa no se vende?":** antes decía "Si quieres terminarlo antes, contáctanos y te explicamos las condiciones de tu acuerdo de listado". Ahora dice: "Puedes terminar tu acuerdo de listado en cualquier momento, sin costo, escribiéndonos. Después de que termine, la comisión solo se paga si, dentro de 90 días, le vendes a un comprador que visitó tu propiedad o hizo una oferta por escrito durante el acuerdo y cuyo nombre te dimos por escrito dentro de los 10 días siguientes a la terminación, y solo si esa venta se cierra."
   - **Solicitud de retiro (panel del vendedor):** antes decía "Tu contrato de 24 meses sigue vigente; ella te contactará si hace falta algo". Ahora dice lo mismo que la FAQ.
   - **Loui:** el prompt agrega esa regla y "There is no cancellation fee".

## Para el abogado

1. **Impuesto sobre la venta.** El párrafo 12 del ERS-21tn menciona "plus applicable sales tax" para la tarifa de cancelación; el párrafo 15 lo deja sin efecto. ¿Hay que decir algo del impuesto sobre la tarifa fija o la comisión?
2. **Validez del párrafo 15 frente a las cláusulas impresas del ERS-21tn.** El párrafo 15 deja sin efecto, entre otros, la frase "closing is not a prerequisite for Broker's fee being earned", el 8(d)(2) y el párrafo 12. Además prevalece sobre los Términos. ¿Es válido y suficiente así, o hay que tachar o iniciar las cláusulas impresas?
3. **Forma del 10(b).** El sitio marca la opción 10(b) del formulario de Florida Realtors (el vendedor paga la compensación al agente del comprador aparte de la comisión de Lixtara). ¿Hace falta algo más en el formulario?
