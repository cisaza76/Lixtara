# Mapa de campos · Lixtara - Commission Agreement (CA-8)

Generado con `scripts/docusign/field-map.ts` desde la plantilla de la cuenta Demo (`c7028b74-2a47-40b6-a612-5c60cb1f0689`, live-demo-2026-10-21) y el código. No se usa hoy: ningún código crea sobres con esta plantilla.
PDF: con capa de texto (se pueden usar anclas). Roles: Seller (orden 1), Broker (orden 2).

**25 campos, 12 con errores.** Posición en puntos desde la esquina superior izquierda; «editable» = lo puede cambiar quien firma.

| Línea | Campo (tabLabel) | Etiqueta en el formulario | Tipo | Rol | Origen del dato | Obligatorio | Editable | Posición y tamaño | Auto-grow | Errores |
|---|---|---|---|---|---|---|---|---|---|---|
| — | `seller_name` | … ("Seller/Landlord") | text | Seller | Lo llena quien firma | sí | sí | p1 x33 y89 · 510×21 · 9 pt | sí | alto 21 pt: más de una línea; auto-grow activo; obligatorio y editable: obliga a escribir algo aunque no aplique |
| — | `broker_name` | … ("Seller/Landlord") | text | Broker | Fijo en la plantilla | no | no | p1 x150 y107 · 300×11 · 9 pt | sí | auto-grow activo |
| — | `deal_type_sell` | diligent effort to (Check as applicable) | checkbox | Seller | Lo llena quien firma | no | sí | p1 x318 y125 · 0×0 · 9 pt | — | — |
| — | `deal_type_lease` | effort to (Check as applicable) sell | checkbox | Seller | Lo llena quien firma | no | sí | p1 x350 y126 · 0×0 · 9 pt | — | — |
| — | `property_address` | … (“Property”) | text | Seller | Lo llena quien firma | sí | sí | p1 x38 y133 · 541×19 · 9 pt | sí | alto 19 pt: más de una línea; auto-grow activo; obligatorio y editable: obliga a escribir algo aunque no aplique |
| — | `consumer_name` | ___ | text | Seller | Lo llena quien firma | sí | sí | p1 x44 y147 · 522×19 · 9 pt | sí | alto 19 pt: más de una línea; auto-grow activo; obligatorio y editable: obliga a escribir algo aunque no aplique |
| — | `protection_period_days` | on ___ [date] or within ___ | text | Seller | Lo llena quien firma | sí | sí | p1 x483 y220 · 36×19 · 9 pt | sí | alto 19 pt: más de una línea; tapa 2 renglones del texto; auto-grow activo; obligatorio y editable: obliga a escribir algo aunque no aplique |
| — | `contract_date` | prospect procured by Broker, on ___ | text | Seller | Lo llena quien firma | sí | sí | p1 x300 y221 · 121×19 · 9 pt | sí | alto 19 pt: más de una línea; tapa 2 renglones del texto; auto-grow activo; obligatorio y editable: obliga a escribir algo aunque no aplique |
| — | `commission_sale_pct` | $___ | text | Seller | Lo llena quien firma | sí | sí | p1 x53 y253 · 119×19 · 9 pt | sí | alto 19 pt: más de una línea; auto-grow activo; obligatorio y editable: obliga a escribir algo aunque no aplique |
| — | `fee_flat` | … $___ | checkbox | Seller | Lo llena quien firma | no | sí | p1 x31 y260 · 0×0 · 9 pt | — | — |
| — | `commission_lease_pct` | … ___% of the gross purchase price | text | Seller | Lo llena quien firma | sí | sí | p1 x45 y271 · 33×19 · 9 pt | sí | alto 19 pt: más de una línea; auto-grow activo; obligatorio y editable: obliga a escribir algo aunque no aplique |
| — | `fee_pct` | … ___% of the gross purchase price | checkbox | Seller | Lo llena quien firma | no | sí | p1 x31 y273 · 0×0 · 9 pt | — | — |
| — | `commission_other_pct` | ___% | text | Seller | Lo llena quien firma | sí | sí | p1 x49 y284 · 27×19 · 9 pt | sí | alto 19 pt: más de una línea; auto-grow activo; obligatorio y editable: obliga a escribir algo aunque no aplique |
| — | `Checkbox faa1911e-1bf3-41f1-ad10-9b6b…` | … ___% of the gross lease value | checkbox | Seller | Lo llena quien firma | no | sí | p1 x31 y286 · 0×0 · 9 pt | — | sin nombre: el código no puede llenarlo ni condicionarlo |
| — | `commission_other_specify` | other (specify) ___ | text | Seller | Lo llena quien firma | sí | sí | p1 x113 y297 · 521×19 · 9 pt | sí | alto 19 pt: más de una línea; se sale del margen derecho; auto-grow activo; obligatorio y editable: obliga a escribir algo aunque no aplique |
| — | `fee_pct e93f481a-f0b9-4b94-8073-cf833…` | … other (specify) ___ | checkbox | Seller | Lo llena quien firma | no | sí | p1 x30 y300 · 0×0 · 9 pt | — | — |
| — | `additional_terms` | Terms: ___ | text | Seller | Lo llena quien firma | no | sí | p1 x118 y525 · 516×19 · 9 pt | sí | alto 19 pt: más de una línea; se sale del margen derecho; auto-grow activo |
| — | `seller_signature_1` | — | signHere | Seller | Lo llena quien firma | no | sí | p1 x124 y564 | — | — |
| — | `Date Signed 5efaea46-69e9-4f3e-a044-e…` | ___ | dateSigned | Seller | Lo llena quien firma | no | sí | p1 x383 y583 · 0×0 · 9 pt | — | — |
| — | `seller_signature_2` | … Date | signHere | Seller | Lo llena quien firma | no | sí | p1 x123 y607 | — | — |
| — | `Date Signed a3d75531-93d3-41b6-a55f-5…` | ___ | dateSigned | Seller | Lo llena quien firma | no | sí | p1 x386 y627 · 0×0 · 9 pt | — | — |
| — | `broker_signature` | … Date | signHere | Broker | Lo llena quien firma (Broker) | no | sí | p1 x120 y652 | — | — |
| — | `Date Signed 54f1913d-b678-4c60-a54c-4…` | ___ | dateSigned | Broker | Lo llena quien firma (Broker) | no | sí | p1 x386 y673 · 0×0 · 9 pt | — | — |
| — | `Initial 2be5cd50-6cbf-45e9-ad64-3b325…` | or Authorized | initialHere | Seller | Lo llena quien firma | no | sí | p1 x112 y714 | — | — |
| — | `lixtara_footer_p*` | pie de página (una por página) | text | Seller | Fijo en la plantilla | no | no | p1 x200 y760 · 280×9 · 7 pt | no | — |
