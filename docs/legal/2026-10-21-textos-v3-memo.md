# Términos v3: memo para el abogado

**Para:** abogado de Lixtara LLC
**Fecha:** 2026-10-21
**Estado:** decisiones de la broker (Anamaria, 2026-10-21). Los tres cambios están **pendientes de revisión** del abogado. Se publican cuando el owner mergee el PR, igual que la v2.

- Memo anterior: `2026-10-18-textos-v2-memo.md`. Sus puntos B3 (cuándo se debe la comisión, período de protección) y B6 (anexo de terminación anticipada) se relacionan con este memo.
- Fuente única de los números: `src/config/listing-agreement.ts` (`PROTECTION_PERIOD_DAYS`) y `src/lib/pricing-tiers.ts` (tarifa fija de cada plan). Ningún texto los escribe a mano.

## Qué cambia

| Documento | Ruta | Versión | Base |
|---|---|---|---|
| Términos de Servicio | `/terms` | 2026-10-21-v3 | v2 + cambio 2 |
| Casilla del paso 8 (`terms_refund`) | paso 8 | 2026-10-21-v3 | v2 + cambio 3 |
| Casilla de registro (`terms`) | `/sign-up`, paso 7 | terms-2026-10-21-v3+privacy-2026-10-18-v2 | mismo texto que la v2: cambia solo la versión de los Términos que se acepta |
| Privacidad, Cookies, Avisos legales, Avisos de corretaje, Accesibilidad | — | 2026-10-18-v2 | sin cambios |

Las aceptaciones ya registradas conservan su versión y su texto: las v1 y v2 de las dos casillas se siguen reconstruyendo con su hash (`src/lib/legal/consents.ts`).

## Los tres cambios (pendientes de revisión)

1. **Anexo de terminación anticipada (Early Termination Addendum): período de protección de 90 días.** — *Pendiente de revisión.*
   - **Antes:** el anexo no existe todavía como texto. Los Términos §16 lo citan ("subject to your signed listing agreement and its Early Termination Addendum") y la nota del 2026-10-17 (`2026-10-17-p0-contenido-notas.md`) lo deja pendiente del abogado. No hay ningún texto publicado con 60 días.
   - **Ahora:** el período de protección es de **90 días** después de la fecha de terminación, en el anexo y en la línea 123 del ERS-21tn ("within 90 days after Termination Date ('Protection Period')"). Sale de `PROTECTION_PERIOD_DAYS`, la misma constante que llena la línea 123 del contrato (PR #217).
   - **Para el abogado:** redactar el anexo con ese plazo. El registro de visitas y ofertas del lado comprador (`property_buyer_contacts`, aprobado con 60 días y sin empezar) debe usar la misma constante.
2. **Términos §6 (y la política de reembolso del sitio): tarifa de cancelación después de publicar en el MLS.** — *Pendiente de revisión.*
   - **Antes (EN):** "…You get a full refund if the broker doesn't approve your listing or it can't be published, if you were charged twice or because of a technical error, or if you cancel before it's published."
   - **Ahora (EN, Términos y sitio):** se agrega "If you cancel after it's published on the MLS, you pay a cancellation fee equal to your plan's flat fee ($199 Essentials, $495 Pro, $995 Concierge), as set out in your listing agreement."
   - **Ahora (ES, Términos, con usted):** "Si usted cancela después de que su propiedad esté publicada en el MLS, pagará una tarifa de cancelación igual a la tarifa fija de su plan ($199 Essentials, $495 Pro, $995 Concierge), según su acuerdo de listado."
   - **Ahora (ES, sitio, con tú):** "Si cancelas después de que esté publicada en el MLS, pagas una tarifa de cancelación igual a la tarifa fija de tu plan ($199 Essentials, $495 Pro, $995 Concierge), según tu acuerdo de listado."
   - Antes de publicar, el reembolso sigue siendo total. La misma política la leen la FAQ, el paso 8, Loui y los correos (`src/config/legal-terms.ts#refundPolicy`, v3).
   - **Coherencia con el contrato:** el párrafo 15 del ERS-21tn (PR #217) dice: "The cancellation fee in Paragraph 12 applies only if the Property has been published in the MLS. If Seller cancels before MLS publication, Seller receives a full refund as stated in Lixtara's Terms of Service, Section 6." La línea 207 lleva la tarifa fija del plan.
   - **Para el abogado:** el párrafo 12 del ERS-21tn dice "pay a cancellation fee of $___ plus applicable sales tax"; los Términos no mencionan el impuesto. Revisar también si la tarifa se suma a la tarifa fija ya pagada (que no se reembolsa después de publicar).
3. **Casilla del paso 8 (checkout).** — *Pendiente de revisión.*
   - **Antes (EN):** "I understand that the {fee} flat fee is charged whether or not my home sells and is non-refundable once my home is published on the MLS. If my listing ends before publication, I receive a full refund. The {pct} commission is due only if a sale closes."
   - **Ahora (EN):** "…If my listing ends before publication, I receive a full refund. If I cancel after publication, I pay a {fee} cancellation fee, equal to my plan's flat fee. The {pct} commission is due only if a sale closes."
   - **Ahora (ES):** "…Si mi listado termina antes de la publicación, recibo el reembolso total. Si cancelo después de la publicación, pago una tarifa de cancelación de {fee}, igual a la tarifa fija de mi plan. La comisión del {pct} solo se paga si la venta se cierra."
   - `{fee}` y `{pct}` son los del plan elegido (`pricing-tiers.ts`).
