# Mapa de campos · Lixtara - Compensation Agreement Seller's Broker to Buyer's Broker (CASSB-1)

Generado con `scripts/docusign/field-map.ts` desde la plantilla de la cuenta Demo (`b07bb028-5776-48a0-8ceb-39bf8ff5fa8a`, live-demo-2026-10-21) y el código. No se usa hoy (`CASSB1_ENABLED = false` en `src/lib/buyer-comp.ts`).
PDF: con capa de texto (se pueden usar anclas). Roles: Buyer (orden 1), BuyerBroker (orden 2), Seller (orden 3), Seller Broker (orden 4).

**30 campos, 15 con errores.** Posición en puntos desde la esquina superior izquierda; «editable» = lo puede cambiar quien firma.

| Línea | Campo (tabLabel) | Etiqueta en el formulario | Tipo | Rol | Origen del dato | Obligatorio | Editable | Posición y tamaño | Auto-grow | Errores |
|---|---|---|---|---|---|---|---|---|---|---|
| — | `seller_name` | Seller: ___ | text | Buyer | Lo llena quien firma | sí | sí | p1 x105 y96 · 469×19 · 9 pt | sí | alto 19 pt: más de una línea; auto-grow activo; obligatorio y editable: obliga a escribir algo aunque no aplique |
| — | `party_seller` | … Seller: ___ ("Seller"); or | checkbox | Buyer | Lo llena quien firma | no | no | p1 x54 y101 · 0×0 · 9 pt | — | — |
| — | `sellers_broker_name` | Seller's Broker: ___ | text | Buyer | Fijo en la plantilla | sí | no | p1 x143 y114 · 391×19 · 9 pt | sí | alto 19 pt: más de una línea; auto-grow activo |
| — | `party_sellers_broker` | … Seller's Broker: ___ ("Seller's Broker") | checkbox | Buyer | Lo llena quien firma | no | no | p1 x54 y119 · 0×0 · 9 pt | — | — |
| — | `buyers_broker_name` | Buyer's Broker: ___ | text | Buyer | Lo llena quien firma | sí | sí | p1 x127 y148 · 409×19 · 9 pt | sí | alto 19 pt: más de una línea; auto-grow activo; obligatorio y editable: obliga a escribir algo aunque no aplique |
| — | `property_address` | Address: ___ | text | Buyer | Lo llena quien firma | sí | sí | p1 x119 y183 · 512×19 · 9 pt | sí | alto 19 pt: más de una línea; se sale del margen derecho; auto-grow activo; obligatorio y editable: obliga a escribir algo aunque no aplique |
| — | `listing_broker_name` | is listed by Seller's Broker, ___. | text | Buyer | Fijo en la plantilla | sí | no | p1 x228 y254 · 388×19 · 9 pt | sí | alto 19 pt: más de una línea; se sale del margen derecho; auto-grow activo |
| — | `property_listed` | … Property is listed by Seller's Broker, | checkbox | Buyer | Lo llena quien firma | no | no | p1 x51 y256 · 0×0 · 9 pt | — | — |
| — | `property_not_listed` | … Property is not listed. | checkbox | Buyer | Lo llena quien firma | no | no | p1 x52 y276 · 0×0 · 9 pt | — | — |
| — | `buyer_name` | … including any | text | Buyer | Lo llena quien firma | sí | sí | p1 x37 y305 · 529×19 · 9 pt | sí | alto 19 pt: más de una línea; auto-grow activo; obligatorio y editable: obliga a escribir algo aunque no aplique |
| — | `term_days` | will remain in effect for ___ | text | Buyer | Lo llena quien firma | sí | sí | p1 x163 y372 · 96×22 · 9 pt | sí | alto 22 pt: más de una línea; auto-grow activo; obligatorio y editable: obliga a escribir algo aunque no aplique |
| — | `fee_amount` | $ | text | Buyer | `cassb1Tabs`: monto fijo (hoy apagado: `CASSB1_ENABLED = false`) | sí | sí | p1 x56 y593 · 179×19 · 9 pt | sí | alto 19 pt: más de una línea; auto-grow activo; dato del sitio editable por el vendedor |
| — | `Checkbox 96ecfe29-6862-4099-9e72-8bac…` | … $ ___ (flat fee) | checkbox | Buyer | Lo llena quien firma | no | sí | p1 x35 y596 · 0×0 · 9 pt | — | sin nombre: el código no puede llenarlo ni condicionarlo |
| — | `fee_pct_plus` | of the Property plus $ ___ | text | Buyer | Lo llena quien firma | sí | sí | p1 x412 y606 · 179×19 · 9 pt | sí | alto 19 pt: más de una línea; auto-grow activo; obligatorio y editable: obliga a escribir algo aunque no aplique |
| — | `fee_pct_value` | ___ | text | Buyer | `cassb1Tabs`: % del precio (hoy apagado: `CASSB1_ENABLED = false`) | sí | sí | p1 x50 y609 · 143×19 · 9 pt | sí | alto 19 pt: más de una línea; auto-grow activo; dato del sitio editable por el vendedor |
| — | `Checkbox 8732b62f-5194-4c11-8e03-ac13…` | … ___ % of the gross purchase | checkbox | Buyer | Lo llena quien firma | no | sí | p1 x35 y612 · 0×0 · 9 pt | — | sin nombre: el código no puede llenarlo ni condicionarlo |
| — | `fee_other_specify` | other (specify): | text | Buyer | Lo llena quien firma | sí | sí | p1 x116 y619 · 517×19 · 9 pt | sí | alto 19 pt: más de una línea; se sale del margen derecho; auto-grow activo; obligatorio y editable: obliga a escribir algo aunque no aplique |
| — | `Checkbox d6b90417-c626-43e8-9546-1106…` | … other (specify): ___ | checkbox | Buyer | Lo llena quien firma | no | sí | p1 x35 y627 · 0×0 · 9 pt | — | sin nombre: el código no puede llenarlo ni condicionarlo |
| — | `other_terms` | terms: ___ | text | Buyer | Lo llena quien firma | sí | sí | p1 x97 y645 · 539×19 · 9 pt | sí | alto 19 pt: más de una línea; se sale del margen derecho; auto-grow activo; obligatorio y editable: obliga a escribir algo aunque no aplique |
| — | `Initial 9a13e80e-7a2f-426e-af67-c1a5c…` | — | initialHere | Seller Broker | Lo llena quien firma (Seller Broker) | no | sí | p1 x286 y676 | — | — |
| — | `Initial 6487d2b6-e6c3-4aad-a889-990fb…` | — | initialHere | BuyerBroker | Lo llena quien firma (BuyerBroker) | no | sí | p1 x497 y677 | — | — |
| — | `lixtara_footer_p*` | pie de página (una por página) | text | Buyer | Fijo en la plantilla | no | no | p1 x200 y760 · 280×9 · 7 pt | no | — |
| — | `Signature 69b9c966-e3cd-49ae-8c96-cd1…` | amount of compensation in Buyer's Broker's | signHere | Seller Broker | Lo llena quien firma (Seller Broker) | no | sí | p2 x262 y492 | — | — |
| — | `Date Signed 918542cc-3e19-4099-a9c1-e…` | or Authorized Associate: ___ Date: ___ | dateSigned | Seller Broker | Lo llena quien firma (Seller Broker) | no | sí | p2 x526 y508 · 0×0 · 9 pt | — | — |
| — | `Signature 2874bf2d-ed8d-49d7-abbb-22a…` | Seller's Broker or Authorized Associate: ___ | signHere | Seller | Lo llena quien firma | no | sí | p2 x380 y510 | — | — |
| — | `Date Signed 66e0bd6e-a79e-49a4-a611-d…` | or Authorized Associate: ___ Date: ___ | dateSigned | Seller | Lo llena quien firma | no | sí | p2 x526 y525 · 0×0 · 9 pt | — | — |
| — | `Signature 45e356e5-2a73-4fce-a43f-ecc…` | or Seller's Broker or Authorized Associate: | signHere | BuyerBroker | Lo llena quien firma (BuyerBroker) | no | sí | p2 x230 y544 | — | — |
| — | `Date Signed 6d8ed2e6-0b11-47be-b59b-3…` | or Authorized Associate: ___ Date: ___ | dateSigned | BuyerBroker | Lo llena quien firma (BuyerBroker) | no | sí | p2 x526 y560 · 0×0 · 9 pt | — | — |
| — | `Initial 59cf5493-a958-4d0f-aa3b-cca87…` | by any | initialHere | Seller | Lo llena quien firma | no | sí | p2 x64 y677 | — | — |
| — | `lixtara_footer_p*` | pie de página (una por página) | text | Buyer | Fijo en la plantilla | no | no | p2 x200 y760 · 280×9 · 7 pt | no | — |
