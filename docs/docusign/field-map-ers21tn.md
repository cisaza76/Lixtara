# Mapa de campos · Lixtara - Listing Agreement (ERS-21tn)

Generado con `scripts/docusign/field-map.ts` desde la plantilla de la cuenta Demo (`bee86256-e6bd-48c6-aa28-760adadfcf07`, live-demo-2026-10-21) y el código. En uso: `POST /api/agreement/create` (paso 7).
PDF: imagen escaneada, sin texto (no se pueden usar anclas: posiciones por coordenadas). Roles: Seller (orden 1), Broker (orden 2).

**39 campos, 24 con errores.** Posición en puntos desde la esquina superior izquierda; «editable» = lo puede cambiar quien firma.

| Línea | Campo (tabLabel) | Etiqueta en el formulario | Tipo | Rol | Origen del dato | Obligatorio | Editable | Posición y tamaño | Auto-grow | Errores |
|---|---|---|---|---|---|---|---|---|---|---|
| 2 | `seller_name` | … ("Seller") | text | Seller | Perfil del vendedor (`users.first_name` + `last_name`; si no hay, el correo) | sí | sí | p1 x49 y77 · 404×19 · 9 pt | sí | alto 19 pt: más de una línea; auto-grow activo; dato del sitio editable por el vendedor |
| 3 | `broker_name` | and brokerage | text | Seller | `BROKERAGE_LICENSED_ENTITY` (`src/lib/broker.ts`) | sí | no | p1 x118 y98 · 289×19 · 9 pt | sí | alto 19 pt: más de una línea; auto-grow activo |
| 5–6 | `start_date` | … property (collectively "Property") described below, at | text | Seller | Fecha de creación del sobre | sí | sí | p1 x65 y138 · 123×19 · 9 pt | sí | alto 19 pt: más de una línea; tapa las líneas 5, 6; auto-grow activo; dato del sitio editable por el vendedor |
| 5–6 | `termination_date` | and terminating at 11:59 p.m. on | text | Seller | Inicio + `termMonths` del plan (`pricing-tiers.ts`) | sí | sí | p1 x329 y140 · 120×19 · 9 pt | sí | alto 19 pt: más de una línea; tapa las líneas 5, 6; auto-grow activo; dato del sitio editable por el vendedor |
| 12–13 | `city` | 2. Description of Property: | text | Seller | `address_city` (se quita: va en `city_state_zip`) | sí | sí | p1 x472 y224 · 84×22 · 9 pt | sí | alto 22 pt: más de una línea; tapa las líneas 12, 13; auto-grow activo; extensión de DocuSign (Smarty) sobre el texto, obligatoria; dato del sitio editable por el vendedor |
| 12–13 | `street_address` | (a) Street Address: | text | Seller | `properties.address_street` (con unidad) | sí | sí | p1 x169 y226 · 316×19 · 9 pt | sí | **la dirección completa (con ciudad, estado y ZIP) y además ciudad, estado y ZIP aparte: repetida**; alto 19 pt: más de una línea; tapa las líneas 12, 13; auto-grow activo; extensión de DocuSign (Smarty) sobre el texto, obligatoria; dato del sitio editable por el vendedor |
| 14 | `zip` | — | text | Seller | `address_zip` (se quita) | sí | sí | p1 x294 y244 · 84×22 · 9 pt | sí | alto 22 pt: más de una línea; auto-grow activo; extensión de DocuSign (Smarty) sobre el texto, obligatoria; dato del sitio editable por el vendedor |
| 14 | `state` | — | text | Seller | `address_state` (se quita) | sí | sí | p1 x86 y245 · 84×22 · 9 pt | sí | alto 22 pt: más de una línea; auto-grow activo; extensión de DocuSign (Smarty) sobre el texto, obligatoria; dato del sitio editable por el vendedor |
| 13 | `com.docusign.extensibilityplatform.ac…` | (a) Street Address: | list | Seller | Lo llena quien firma | sí | sí | p1 x166 y247 · 156×0 · 9 pt | — | extensión de DocuSign (Smarty) sobre el texto, obligatoria |
| 15 | `legal_description` | Legal Description: | text | Seller | Condado, verificado al firmar (`verifiedLegalDescription`: misma dirección → mismo folio) | sí | sí | p1 x164 y264 · 480×21 · 9 pt | sí | **el sitio la mandó vacía (el condado no la devolvió) y, por ser obligatoria y editable, quien firmó escribió «three-bedroom townhouses»; la del condado tiene varias líneas y desbordaba hasta L18**; alto 21 pt: más de una línea; se sale del margen derecho; auto-grow activo; dato del sitio editable por el vendedor |
| 17 | `personal_property` | (b) Personal Property, including appliances: | text | Seller | Paso 3, electrodomésticos incluidos (`properties.appliances`) | sí | sí | p1 x280 y305 · 330×19 · 9 pt | sí | **dos campos: L17 y un cuadro que crece sobre L18–L20**; campo duplicado (misma etiqueta dos veces); alto 19 pt: más de una línea; se sale del margen derecho; auto-grow activo; dato del sitio editable por el vendedor |
| 18 | `personal_property` | … O See Attachment | text | Seller | Paso 3, electrodomésticos incluidos (`properties.appliances`) | sí | sí | p1 x84 y319 · 328×23 · 9 pt | sí | **dos campos: L17 y un cuadro que crece sobre L18–L20**; campo duplicado (misma etiqueta dos veces); alto 23 pt: más de una línea; auto-grow activo; dato del sitio editable por el vendedor |
| 19–20 | `lease_end_date` | (c) Occupancy: | text | Seller | Paso 3, `lease_end_date` (MM/DD/YYYY, solo con inquilino; vacía con «No la sé») | sí | sí | p1 x482 y348 · 122×22 · 9 pt | sí | **obligatorio aunque no haya inquilino: quien firmó escribió «31/12/2026» (DD/MM)**; alto 22 pt: más de una línea; tapa las líneas 19, 20; se sale del margen derecho; auto-grow activo; dato del sitio editable por el vendedor |
| 20 | `occupancy_status` | Property C] is | checkbox | Seller | Paso 3, `occupancy_status` (se quita: pasa a `occupancy`) | no | sí | p1 x150 y356 · 0×0 · 9 pt | — | **las dos casillas (is / is not) tienen la misma etiqueta: el sitio mandó las dos sin marcar y, al marcar una, DocuSign marcó las dos**; misma etiqueta en varias casillas: marcar una marca todas |
| 20 | `occupancy_status` | Property | checkbox | Seller | Paso 3, `occupancy_status` (se quita: pasa a `occupancy`) | no | sí | p1 x124 y357 · 0×0 · 9 pt | — | **las dos casillas (is / is not) tienen la misma etiqueta: el sitio mandó las dos sin marcar y, al marcar una, DocuSign marcó las dos**; misma etiqueta en varias casillas: marcar una marca todas |
| 21–22 | `list_price` | 3. Price and Terms: | text | Seller | Paso 3, `list_price` (sin «$») | sí | sí | p1 x121 y379 · 123×19 · 9 pt | sí | **«$» repetido: el formulario imprime «$» y el sitio mandaba «$650,000»**; alto 19 pt: más de una línea; tapa las líneas 21, 22; auto-grow activo; dato del sitio editable por el vendedor |
| 22 | `Text 83050f56-a8c7-4790-bf15-47bd814d…` | (a) Price: $. | text | Seller | Lo llena quien firma | sí | sí | p1 x435 y389 · 190×19 · 9 pt | sí | **es «Other (specify)» de L23: obligatorio y sin condición, obligó a escribir algo aunque «Other» no esté marcado («Cash» el 2026-10-20)**; sin nombre: el código no puede llenarlo ni condicionarlo; alto 19 pt: más de una línea; se sale del margen derecho; auto-grow activo; obligatorio y editable: obliga a escribir algo aunque no aplique |
| 23 | `Checkbox 1cd98371-ce0f-48fd-b524-c646…` | Financing Terms: [J Cash 1 Conventional | checkbox | Seller | Lo llena quien firma | no | sí | p1 x287 y396 · 0×0 · 9 pt | — | sin nombre: el código no puede llenarlo ni condicionarlo |
| 23 | `cash_only` | (b) Financing Terms: | checkbox | Seller | Paso 3, `cash_only` (pasa a `financing_cash`) | no | sí | p1 x170 y397 · 0×0 · 9 pt | — | — |
| 23 | `Checkbox 18617c6f-b38e-4376-817f-5b0e…` | (b) Financing Terms: [J Cash | checkbox | Seller | Lo llena quien firma | no | sí | p1 x211 y397 · 0×0 · 9 pt | — | sin nombre: el código no puede llenarlo ni condicionarlo |
| 23 | `Checkbox 6f2d0843-ec2d-499a-add5-370d…` | [J Cash 1 Conventional 1 VA | checkbox | Seller | Lo llena quien firma | no | sí | p1 x317 y397 · 0×0 · 9 pt | — | sin nombre: el código no puede llenarlo ni condicionarlo |
| 23 | `Checkbox 4ac2b140-42aa-4629-a2de-6de5…` | 1 Conventional 1 VA (1 FHA | checkbox | Seller | Lo llena quien firma | no | sí | p1 x355 y397 · 0×0 · 9 pt | — | sin nombre: el código no puede llenarlo ni condicionarlo |
| — | `lixtara_footer_p*` | pie de página (una por página) | text | Seller | Fijo en la plantilla | no | no | p1 x200 y760 · 280×9 · 7 pt | no | — |
| 71 | `lockbox_authorized` | (e) (Check if applicable) | checkbox | Seller | Plan: Concierge siempre; Pro si la casa está vacía | no | sí | p2 x183 y291 · 0×0 · 9 pt | — | — |
| — | `lixtara_footer_p*` | pie de página (una por página) | text | Seller | Fijo en la plantilla | no | no | p2 x200 y760 · 280×9 · 7 pt | no | — |
| 109–110 | `commission_pct` | terms | text | Seller | Plan, `commissionPct` (sin «%») | sí | no | p3 x83 y62 · 61×19 · 9 pt | sí | **«%» repetido: el sitio mandaba «1%» antes del «%» impreso**; alto 19 pt: más de una línea; tapa las líneas 109, 110; auto-grow activo |
| 109–110 | `flat_fee` | Seller. Seller will pay Broker as | text | Seller | Plan, `flatFee` (sin «$») | sí | no | p3 x298 y62 · 124×19 · 9 pt | sí | **«$» repetido: «$495» después del «$» impreso**; alto 19 pt: más de una línea; tapa las líneas 109, 110; auto-grow activo |
| 144–145 | `buyer_agent_commission` | buyer's broker in the amount of: | text | Seller | Paso 6 (pasa a `buyer_comp_pct` / `buyer_comp_amount`) | sí | no | p3 x500 y490 · 39×21 · 9 pt | sí | **«%» repetido, y un monto fijo («$12,000») caía en la línea del porcentaje; el monto va en L146**; alto 21 pt: más de una línea; tapa las líneas 144, 145; auto-grow activo |
| 145 | `buyer_commission_ack` | (a) LJ | checkbox | Seller | Paso 6: marcada si ofrece compensación (> 0) | no | sí | p3 x119 y494 · 0×0 · 9 pt | — | — |
| — | `lixtara_footer_p*` | pie de página (una por página) | text | Seller | Fijo en la plantilla | no | no | p3 x200 y760 · 280×9 · 7 pt | no | — |
| — | `lixtara_footer_p*` | pie de página (una por página) | text | Seller | Fijo en la plantilla | no | no | p4 x200 y760 · 280×9 · 7 pt | no | — |
| — | `lixtara_footer_p*` | pie de página (una por página) | text | Seller | Fijo en la plantilla | no | no | p5 x200 y760 · 280×9 · 7 pt | no | — |
| 246 | `Signature 5b454ad7-0777-40a5-8737-92b…` | Seller's Signature: | signHere | Seller | Lo llena quien firma | no | sí | p6 x163 y10 | — | — |
| 246 | `Date Signed b70b18fb-c0d8-4c86-a08b-2…` | Seller's Signature: Date: | dateSigned | Seller | Lo llena quien firma | no | sí | p6 x444 y28 · 0×0 · 9 pt | — | — |
| 253 | `Date Signed 0746284a-32dd-474d-9a14-4…` | Email Address: | dateSigned | Broker | Lo llena quien firma (Broker) | no | sí | p6 x439 y211 · 0×0 · 9 pt | — | — |
| 253 | `Signature db81ac6b-c663-4b0f-9438-c0c…` | Email Address: | signHere | Broker | Lo llena quien firma (Broker) | no | sí | p6 x213 y217 | — | — |
| 257 | `Initial 6c8a50fa-c35c-4c89-aab8-5238c…` | Copy | initialHere | Seller | Lo llena quien firma | no | sí | p6 x88 y729 | — | — |
| 257 | `Initial bf5224fd-c077-4a64-97d5-ce1ae…` | Copy returned to Seller on | initialHere | Broker | Lo llena quien firma (Broker) | no | sí | p6 x276 y729 | — | — |
| — | `lixtara_footer_p*` | pie de página (una por página) | text | Seller | Fijo en la plantilla | no | no | p6 x200 y760 · 280×9 · 7 pt | no | — |

## Después del arreglo (`scripts/docusign/apply-template-fixes.ts`)

Campos que llena el sitio, con su posición nueva (`src/lib/docusign/ers21tn-layout.ts`). Firmas, iniciales, fechas de firma y pie de página no cambian.

| Línea | Campo | Tipo | Origen del dato | Obligatorio | Editable | Posición y tamaño | Auto-grow | Condición |
|---|---|---|---|---|---|---|---|---|
| 2 | `seller_name` | text | Perfil del vendedor (`users.first_name` + `last_name`; si no hay, el correo) | sí | no | p1 x53 y82 · 474×11 · 9 pt | no | — |
| 3 | `broker_name` | text | `BROKERAGE_LICENSED_ENTITY` (`src/lib/broker.ts`) | sí | no | p1 x120 y99 · 402×11 · 9 pt | no | — |
| 6 | `start_date` | text | Fecha de creación del sobre | sí | no | p1 x71 y144 · 107×11 · 9 pt | no | — |
| 6 | `termination_date` | text | Inicio + `termMonths` del plan (`pricing-tiers.ts`) | sí | no | p1 x332 y144 · 107×11 · 9 pt | no | — |
| 13 | `street_address` | text | `properties.address_street` (con unidad) | sí | no | p1 x166 y231 · 408×11 · 9 pt | no | — |
| 14 | `city_state_zip` | text | `address_city`, `address_state` `address_zip` | sí | no | p1 x89 y248 · 299×11 · 9 pt | no | — |
| 15 | `legal_description` | text | Condado, verificado al firmar (`verifiedLegalDescription`: misma dirección → mismo folio) | no | no | p1 x172 y271 · 402×11 · 9 pt | no | — |
| 16 | `legal_description_2` | text | Segunda línea de la descripción legal verificada | no | no | p1 x89 y292 · 285×11 · 9 pt | no | — |
| 16 | `legal_see_attachment` | checkbox | Marcada si no hay descripción legal verificada o no cabe en L15–L16 | no | no | p1 x380 y293 | — | — |
| 17 | `personal_property` | text | Paso 3, electrodomésticos incluidos (`properties.appliances`) | no | no | p1 x286 y310 · 288×11 · 9 pt | no | — |
| 18 | `personal_property_see_attachment` | checkbox | Marcada si la lista no cabe en L17 | no | no | p1 x380 y327 | — | — |
| 20 | `occupancy` | radio | Paso 3, `occupancy_status` (inquilino → is; vacía u ocupada por el dueño → is not) | sí | sí | is: p1 x128 y357 · is_not: p1 x152 y357 | — | — |
| 20 | `lease_end_date` | text | Paso 3, `lease_end_date` (MM/DD/YYYY, solo con inquilino; vacía con «No la sé») | no | no | p1 x491 y355 · 79×11 · 9 pt | no | solo si `occupancy` = is |
| 22 | `list_price` | text | Paso 3, `list_price` (sin «$») | sí | no | p1 x125 y384 · 107×11 · 9 pt | no | — |
| 23 | `financing_cash` | checkbox | Paso 3, `financing_terms` incluye cash | no | no | p1 x172 y397 | — | — |
| 23 | `financing_conventional` | checkbox | Paso 3, `financing_terms` incluye conventional | no | no | p1 x213 y397 | — | — |
| 23 | `financing_va` | checkbox | Paso 3, `financing_terms` incluye va | no | no | p1 x289 y397 | — | — |
| 23 | `financing_fha` | checkbox | Paso 3, `financing_terms` incluye fha | no | no | p1 x319 y397 | — | — |
| 23 | `financing_other` | checkbox | Paso 3, `financing_terms` incluye other | no | no | p1 x357 y397 | — | — |
| 23 | `financing_other_specify` | text | Paso 3, `financing_other` (solo con Other) | no | no | p1 x444 y396 · 129×11 · 9 pt | no | solo si `financing_other` = on |
| 71 | `lockbox_authorized` | checkbox | Plan: Concierge siempre; Pro si la casa está vacía | no | no | p2 x187 y291 | — | — |
| 110 | `commission_pct` | text | Plan, `commissionPct` (sin «%») | sí | no | p3 x89 y67 · 51×11 · 9 pt | no | — |
| 110 | `flat_fee` | text | Plan, `flatFee` (sin «$») | sí | no | p3 x301 y67 · 107×11 · 9 pt | no | — |
| 145 | `buyer_commission_ack` | checkbox | Paso 6: marcada si ofrece compensación (> 0) | no | no | p3 x119 y494 | — | — |
| 145 | `buyer_comp_pct` | text | Paso 6, oferta en % (sin «%») | no | no | p3 x509 y494 · 29×11 · 9 pt | no | — |
| 146 | `buyer_comp_amount` | text | Paso 6, oferta en monto fijo (sin «$») | no | no | p3 x211 y505 · 79×11 · 9 pt | no | — |
