# Textos legales v1: memo para el abogado

**Para:** abogado de Lixtara LLC
**Fecha:** 2026-10-18
**Estado de cada texto de este memo: PENDIENTE DE APROBACIÓN LEGAL.** Están en el código para poder revisarlos en su lugar, pero ninguno es texto final.

Paquete en PDF: `docs/legal/paquete-abogado-2026-10/`.

## Textos

| # | Texto | Dónde vive | Dónde se muestra | Estado |
|---|---|---|---|---|
| 1 | Casilla del checkout (paso 8), EN y ES, con `{fee}` y `{pct}` del plan | `src/lib/legal/consents.ts` (`terms_refund`, versión `2026-10-18-v1`) | Paso 8, antes de "Pagar con Stripe"; el servidor la exige | Pendiente de aprobación legal |
| 2 | Cláusula de jerarquía de acuerdos | `src/lib/legal/terms.ts`, §1 (y §20 remite a ella) | Términos | Pendiente de aprobación legal |
| 3 | Arbitraje y renuncia a acciones colectivas (§17), EN del owner; ES con usted | `src/lib/legal/terms.ts`, §17 | Términos | Pendiente de aprobación legal |
| 4 | Privacidad 7.1 "Proof of Consent" | `src/lib/legal/privacy.ts` | Política de Privacidad | Pendiente de aprobación legal |
| 5 | Compensación al agente del comprador, v3 | `src/config/legal-terms.ts` (`buyerAgentComp.policy` / `policyTerms`) | FAQ, Términos §4.1, Loui | Pendiente de aprobación legal |
| 6 | Política de reembolso v2 (agrega "se cobra se venda o no") | `src/config/legal-terms.ts` (`refundPolicy`) | Términos §6, FAQ, paso 8, Loui | Pendiente de aprobación legal |
| 7 | Aviso E-SIGN del paso 7 (texto del #203; ES pasa a tú) | `src/lib/legal/consents.ts` (`esign`, `2026-10-18-v1`) | Paso 7, antes de abrir DocuSign; el servidor lo exige | Pendiente de aprobación legal |
| 8 | "Lixtara LLC", dirección y licencias en Privacidad y Avisos Legales | `privacy.ts`, `disclaimers.ts` (desde `brokerage.ts`) | Privacidad, `/disclaimers` | Pendiente de aprobación legal |
| 9 | Correos legales (`legal@`, `privacy@`, `notices@`, `dmca@`, `support@`) | `src/config/brokerage.ts` | Todos los textos legales | Confirmar que los buzones existen |

Prueba de cada aceptación (casillas 1 y 7): tabla `terms_acceptances`. Guarda fecha, IP, user agent, versión, idioma y SHA-256 del texto exacto, incluido el precio del plan. Es de solo inserción y se escribe solo desde el servidor. Migración `20261019120000_terms_acceptances.sql`, **sin aplicar**.

## Puntos para el abogado

1. **Retención frente a la tabla de solo inserción.** La 7.1 promete borrar el registro 5 años después de que termine la relación. Hoy la tabla no permite borrar a nadie, ni al `service_role`, y no registra cuándo termina la relación. Hace falta definir qué cuenta como fin de la relación y una purga controlada, que no está construida.
2. **Borrado de la cuenta.** Si se borra el usuario, la prueba se conserva con `user_id` en NULL. ¿Basta para defender un reclamo, o hay que conservar un identificador?
3. **Arbitraje "within thirty (30) days after you first accept these Terms".** Hoy no hay aceptación expresa de los Términos al crear la cuenta (punto 5 del memo del #203). Sin ella, no hay una fecha clara de "first accept".
4. **"your use of the Site"** en la §17(a), mientras el resto de los Términos dice "the Services". ¿Se deja así o se cambia a "the Services"?
5. **Compensación: base del 3%.** El texto dice "of the purchase price". El sistema hoy valida el tope de un monto fijo contra el precio de **lista** (migración `20261017200000`). Confirmar si se cambia la regla o el texto.
6. **"buyer's broker" en español.** Se tradujo como "agente del comprador", el término del glosario del sitio. ¿Correcto en contexto legal?
7. **E-SIGN en español con tú.** El paso 7 es parte del flujo del vendedor, que usa tú. Los Términos usan usted. Confirmar que el aviso E-SIGN puede ir con tú.
8. **Sin arbitraje masivo por lotes** (decisión del owner). Se retiró además la frase "The arbitrator may not consolidate more than one person's claims".

## Lo que queda en el #203 (borrador)

El resto del juego de documentos (Cookies, Notices, Accesibilidad, proveedores, Clarity), la casilla de llamadas/SMS (`calls_sms`, definida pero sin formulario) y el memo completo `memo-revision-2026-10-16.md`.
