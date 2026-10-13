# Lixtara · Búsqueda conversacional + representación del comprador: plan estratégico

**Estado:** decisiones de los bloques 1 a 6 cerradas; documentos escritos el 2026-10-10 en `docs/planning/2026-10-compradores/` (anexos en los archivos 01–04). Nada se implementa sin aprobación explícita.

**Principio rector:** *"Lixtara utiliza tecnología para reducir los costos de las transacciones inmobiliarias sin eliminar el acompañamiento de un profesional real."*
- **Vendedores:** reducir el costo de vender (0,5 / 1 / 1,5 %) mediante tecnología.
- **Compradores:** búsqueda eficiente con acompañamiento humano.

**Principio de producto:** *"La tecnología facilita encontrar la propiedad. Un Realtor real acompaña al comprador durante el proceso."* Ninguna IA negocia, representa ni cierra operaciones.

---

## 0. Dos negocios separados (corrección del owner, 2026-10-10)

| | **Listings: representación del vendedor** | **Buyer brokerage: representación del comprador** |
|---|---|---|
| Cliente | Vendedor | Comprador |
| Ingreso | Fee del plan ($199 / $495 / $995) + comisión de **0,5 % / 1 % / 1,5 %** según el plan (`src/lib/pricing-tiers.ts`) | Compensación de **2 % / 2,5 % / 3 %**, **preferida: 3 %**, siempre negociada caso por caso |
| Contrato | Listing agreement (DocuSign, plantilla existente) | **Showing Agreement de Lixtara** (nuevo, revisado por un abogado) y, más adelante, un acuerdo exclusivo |
| Embudo | Landing → `/listing/new` | `/properties` → ficha → visita |
| Posicionamiento | **Principal** | Secundario, con atención humana |

**Reglas:**
- **Nunca se usan los % de un negocio en el otro.**
- **No se asumen rebates ni créditos al comprador.** Cualquier rebate o crédito es una decisión comercial separada, que todavía no se ha tomado.

### Buyer Rebate Program publicado hoy: decisión tomada, sin implementar

**Contexto:** `src/lib/buyer-rebate.ts` (`LIXTARA_BUYER_FEE_PCT = 0.5`, `REBATE_CAP`), la sección "Buyer rebate program" de la landing con su `RebateSlider`, y `CLAUDE.md` (que lo trata como convención) ya no reflejan la propuesta vigente.

**Decisión del owner:** reemplazar esa sección por una de servicios para compradores, **cuando lo autorice**.
- **Titular:** "Find your next home. We'll guide you every step of the way."
- **Texto secundario:** "Search smarter with Lixtara and get personalized guidance from a real estate professional — from your first showing to closing."
- **CTA:** "Explore Homes", que enlaza a `/properties`. También necesita su versión en español.
- **Qué destaca:** búsqueda inteligente, transparencia y atención personal de una Realtor real.
- **Qué no muestra:** porcentajes del comprador, rebate, devolución de comisiones ni calculadora.
- **El resto de la landing** (propuesta de vendedor con 0,5 / 1 / 1,5 %) queda intacto.
- **El código del rebate** solo se conserva si sirve para una decisión futura, y queda **inactivo**.
- **`CLAUDE.md` y la documentación** se actualizan: el programa anterior ya no es parte de la propuesta.
- **Fuera de alcance hasta autorización expresa:** no se toca código, landing ni `CLAUDE.md`.

---

## 1. Diagnóstico (verificado en el repo)

- **Inventario:** 0 propiedades propias activas y 50.836 fichas MLS. La exhibición está **apagada** (Fase 3 pendiente).
- **Búsqueda:** formulario GET (`src/lib/property-search.ts`) sin mapa, ciudad, tipo ni texto libre. **Las tarjetas MLS no se pueden abrir**, no hay detalle MLS, no se pueden guardar y no hay botón de visita.
- **Embudo del comprador:** `buyer_leads` existe pero nada la escribe. Las visitas solo se piden por Loui. Hay una sola Realtor (Ana María) y ninguna cuenta de broker.
- **IA:** Loui funciona con Sonnet 4.6, AI SDK v6 y 3 tools, con límites Upstash. No hay embeddings, preferencias ni alertas.
- **Frontera legal §III.B.4:** prohíbe dar contenido MLS a una IA. La aplican `src/lib/mls/ai-boundary.test.ts` y el tipo `MlsLicensed<T>`. No hay ninguna excepción.
- **Medición:** existe `dataLayer`, pero **no hay ningún tag instalado**.
- **Entidad licenciada:** `src/config/brokerage.ts` registra a **Lixtara LLC, Real Estate Corporation, CQ1075352** (vence el 30-09-2028) y a la broker **Anamaria Velasquez, BK3664191** (vence el 30-09-2027). Verificado en el DBPR el 27-09-2026. **Re-verificar antes de lanzar.**

---

## 2. Las cuatro capas

| Capa | Qué hace | Ve datos MLS | Usa LLM |
|---|---|---|---|
| **A. Asesor de búsqueda** | Conversa y produce `SearchCriteria` | **Nunca** | Sí |
| **B. Motor de búsqueda** | Criterios → URL → `getPublicMlsListings` | Sí | **Nunca** |
| **C. Presentación MLS** | Tarjetas, detalle, atribución y avisos | Sí | **Nunca** |
| **D. Embudo del comprador** | Lead, acuerdo, visita y asignación | Solo IDs/URLs | **No** |

- **La URL de `/properties` es el único contrato entre A y B.**
- **A vive en una ruta propia** (`/api/search-assistant`). No importa `lib/mls`, ni `mls_listings`, ni las tablas de leads.
- **El modelo recibe solo:**
  - los mensajes;
  - el `SearchCriteria` actual (valores elegidos por el usuario);
  - vocabularios **estáticos** de Lixtara: condados, municipios oficiales, tipos y escalones.
- **El modelo nunca recibe:** conteos, "sin resultados", fichas vistas o guardadas, ni listas derivadas del feed.

---

## 3. §III.B.4: cumplimiento y preguntas para MIAMI

**El diseño es defendible pero no está garantizado.** Tiene tres riesgos residuales:

1. **Que el usuario pegue una ficha en el chat.** Mitigación: se detectan URLs, direcciones y números de MLS, y se responden con un mensaje fijo sin pasar por el modelo.
2. **Señales derivadas, como reaccionar a "0 resultados".** Mitigación: la relajación de criterios la hace código determinístico, fuera del chat.
3. **Vocabularios o logs derivados del feed.** Mitigación: listas oficiales, y tablas de conversación separadas de las tablas con IDs MLS.

**Preguntas por escrito a MIAMI:**
- **P1.** ¿El parser ciego cumple §III.B.4?
- **P2.** ¿El contenido que pega el consumidor es responsabilidad del participante? ¿Basta la mitigación?
- **P3.** ¿Se permiten alertas por email con fichas, o solo un enlace?
- **P4.** ¿Se permite pedir registro y poner el CTA "Agendar visita con Lixtara" en fichas de otros brokers?
- **P5.** ¿Qué campos y qué mapa se permiten en el detalle IDX?
- **P6 (nueva).** Pedir el texto vigente de las **MIAMI MLS Rules 2026**, incluida su versión de la Policy 8.13.

**Regla:** la IA no se activa sin P1 por escrito. La base (capas B, C y D) se puede construir antes.

---

## 4. Conversación (capa A)

- **Entrada:** panel destacado en `/properties`, móvil primero. Los filtros clásicos siguen disponibles. La landing no cambia.
- **Pregunta inicial abierta:** "Cuéntame qué buscas." El modelo extrae todo lo que pueda de esa frase.
- **Después pregunta solo lo que falta**, en este orden: zona → presupuesto → habitaciones → tipo → indispensables.
  - Muestra resultados con zona + presupuesto. Máximo 4 preguntas.
  - El botón "Ver resultados ya" está siempre visible.
- **Chips** de respuesta rápida, con texto libre siempre disponible. Cada respuesta tiene 1 o 2 frases.
- **Calificación separada de los filtros:** plazo, financiamiento, **"¿tienes acuerdo con otro agente?"** y **"¿necesitas vender primero?"**.
  - Esta última es la venta cruzada discreta hacia el negocio de listings.
  - Estos datos nunca van a la URL. Prellenan el lead.
- **Lo que no se puede filtrar** (luz, vistas…) se dice con honestidad.
- **Fair Housing:**
  - El asistente no caracteriza zonas ("tranquila", "familiar", "buenos colegios").
  - No pregunta por la composición del hogar ni por atributos protegidos.
  - No infiere habitaciones a partir de la familia.
  - Si el usuario nombra un colegio, se toma como referencia elegida por él.
  - Un set de red-team en ES y EN se corre en CI.

## 5. Criterios estructurados (A → B)

- **Esquema:** `SearchCriteria` validado con zod: zona (condado, ciudades, zips), precio mín/máx, cuartos, baños y tipo.
  - **Fase 2:** pool, waterfront, HOA máx., área y año de construcción.
- **Mecanismo:** un único tool, `update_search`. El servidor lo valida contra listas cerradas (`parsePropertySearch`).
- **Cambios al motor:**
  - `city` y `propertyType`.
  - Después, pool, waterfront y HOA como columnas con trigger. Es el mismo patrón que `20261011120000`, ya probado y con relleno en tandas.

## 6. Presentación (capa C, sin IA)

- **Layout:** chat y resultados en panel dividido en escritorio, y en hoja inferior en móvil.
- **Chips de criterios editables.** La URL es la verdad.
- **"Por qué aparece":** chips determinísticos ("3 hab ✓", "≤ $600k ✓").
- **0 resultados:** sugerencia determinística de relajación.
- **Prerrequisitos:**
  - Tarjetas clicables con dirección, cuartos y baños.
  - **Página de detalle MLS** con atribución y avisos.
  - Mapa más adelante.

## 7. Refinamiento

- El modelo recibe la conversación y el `SearchCriteria` actual. Nada de fichas, conteos ni "no me gustó la de 123 Main St".
- "Más como esta" (fase 2) es **determinístico**.

---

## 8. Buyer brokerage: modelo de compensación (solo comprador)

### Reglas que se aplican (investigadas el 2026-10-10; no son asesoría legal)

- **NAR Policy 8.13:**
  - Hace falta un acuerdo escrito **antes de un tour**, presencial o virtual en vivo.
  - La compensación debe ser **objetivamente determinable**: no un rango, ni "lo que ofrezca el vendedor".
  - **No se puede recibir de ninguna fuente más de lo acordado.**
  - Debe declararse de forma conspicua que **no está fijada por ley y es negociable**.
  - La duración, el alcance y la exclusividad son libres.
- **F.S. 475.278:** transaction broker (la relación presunta) o single agent. La dual agency está prohibida.
  - **Decisión del owner: transaction broker por defecto.**
- **Documentación de pagos de terceros:**
  - **CASB:** vendedor → broker del comprador.
  - **CABB:** listing broker → broker del comprador.
  - Términos en el contrato de compraventa, incluido el Rider GG.
- **Código de Ética 2026:** un laudo no puede exceder lo pactado en el acuerdo de comprador (SOP 17-4).

### Fuentes de pago y tope
- Lixtara recibe **como máximo** el % pactado (2 / 2,5 / 3 %), sumando todas las fuentes:
  1. Vendedor (CASB o contrato).
  2. Listing broker (CABB).
  3. El comprador, por la diferencia.
- **Si el vendedor ofrece más que lo pactado,** el excedente **no** va a Lixtara. Qué hacer con él (que lo negocie el comprador, por ejemplo) es una **decisión comercial separada**. No se asume ningún crédito.

### Cuando lo disponible es menor que lo pactado

**Ejemplo:** pactado 3 % y el vendedor ofrece 2 %. Hay tres caminos, que el acuerdo debe prever **por escrito antes del tour**:
- **(a) El comprador paga la diferencia (1 %) al cierre.**
  - Es la obligación máxima, declarada en el resumen y en el acuerdo.
  - **Restricciones del lender:** algunos préstamos limitan que el comprador pague o financie la comisión. Lo valida el abogado o el lender.
- **(b) Pedir la diferencia en la oferta,** como pago del vendedor al broker del comprador. Depende de la negociación.
- **(c) Lixtara acepta por escrito una compensación menor** antes de la oferta. Solo a la baja, nunca al alza.
- **Siempre, antes de redactar cada oferta:** una **"hoja de verificación de compensación"** firmada por el comprador, con el % pactado, lo que ofrece el vendedor y el desembolso estimado del comprador.

### Escenario A · faltante de compensación (decisión del owner, para el abogado)

Aplica cuando lo que ofrece el vendedor o el listing broker es **menor** que lo pactado con el comprador (2 / 2,5 / 3 %, negociado individualmente).

1. **Primero:** negociar la diferencia en la oferta, con los mecanismos contractuales permitidos (CASB/CABB o términos del contrato).
2. **Si el vendedor no acepta:** Ana María **puede evaluar** reducir la comisión de Lixtara, con aprobación de la brokerage y **por escrito**.
3. **Si Lixtara no reduce:** el comprador **decide voluntariamente** si cubre la diferencia, siempre dentro de la **obligación máxima** que aceptó expresamente en su acuerdo.
4. **El comprador puede desistir** de esa propiedad.

**Reglas**
- **Antes de cada oferta:** desglose firmado con lo pactado, las fuentes, el faltante y las opciones. La decisión del comprador queda documentada.
- Lixtara **no absorbe automáticamente** la diferencia, y el comprador **nunca recibe una obligación inesperada** al cierre.
- **Sistema:** Ana María registra excepciones y reducciones conforme a sus facultades. **Ningún acuerdo cambia automáticamente.**
- **No se promete** que el vendedor pague todo ni que el comprador nunca aporte.

### Presentación de la compensación (decisión del owner)

**Propuesta y alternativas**
- **3 %** es la **propuesta comercial preferida** para la representación integral. No es una tarifa obligatoria, ni un estándar de mercado, ni la fija la ley.
- **2 % y 2,5 %** se negocian individualmente con Ana María. **No se convierten en "planes"** mientras no existan diferencias reales de servicio.

**Qué debe explicar la web**
- El valor del acompañamiento de Ana María: orientación, coordinación de visitas, análisis de alternativas, negociación y acompañamiento en la transacción, dentro de sus funciones autorizadas.

**Antes de DocuSign, el comprador debe ver**
- La compensación propuesta.
- Que es **negociable**.
- Las fuentes posibles de pago.
- Su **obligación económica máxima**.

**Salida visible**
- **"Quiero hablar con Ana María sobre la compensación"**: continúa como lead sin firmar.

**Prohibido afirmar**
- Que "el vendedor siempre paga".
- Que "el comprador nunca paga".

**Sin patrones oscuros**
- Ninguna casilla preseleccionada.
- "Continuar con 3 %" y "Hablar sobre la compensación" tienen el **mismo peso visual**.
- Sin cuenta regresiva ni copy que presione.

**El acuerdo**
- Refleja **exactamente** el % acordado individualmente.
- Tope total combinado de todas las fuentes.

**Alcance limitado frente a integral**
- **Recomendación:** misma tasa por propiedad. Si el comprador compra una propiedad identificada, el trabajo hasta el cierre es el mismo. Lo "integral" del acuerdo exclusivo es la **amplitud** (todas las propiedades y búsqueda activa), no un servicio distinto por propiedad.
- Una tasa menor para "solo visita" no tiene sentido. Si el comprador compra, Lixtara hace la transacción completa.
- Esto se revisa con el abogado y con datos.

### Ingresos brutos potenciales por operación (antes de splits o referidos)

| Precio | 2 % | 2,5 % | 3 % |
|---|---|---|---|
| $300.000 | $6.000 | $7.500 | $9.000 |
| $500.000 | $10.000 | $12.500 | $15.000 |
| $700.000 | $14.000 | $17.500 | $21.000 |
| $1.000.000 | $20.000 | $25.000 | $30.000 |

**Supuestos y advertencias:**
- Es **bruto para la brokerage por operación cerrada**. No es ingreso esperado por lead.
- **No se asume** que el comprador acepte el 3 % ni que el vendedor cubra toda la compensación.
- **Etapa 2:** si atiende un asociado interno, se resta su split. Si se refiere a otra brokerage, Lixtara recibe solo el referral fee pactado entre brokers.
- **Ingreso esperado:** se calculará con datos reales del embudo (solicitud → firma → tour → oferta → cierre) y la tasa efectiva cobrada.

### Coherencia con la misión: escenarios A y B

**Supuestos (a validar):**
- Referencia "tradicional" de **6 % total** (3 + 3), que es la cifra que la propia landing usa.
- En los listings de Lixtara, el vendedor elige el plan Pro (**1 %**) y ofrece **2,5 %** para el agente del comprador (`properties.buyer_agent_commission`).
- Precio de **$500.000**.
- Las cifras son brutas, **ilustrativas y no son proyecciones**.

#### Escenario A: Lixtara representa al comprador de un listing de otra brokerage

| Variante | Lixtara recibe | Costo del comprador | Diferenciación |
|---|---|---|---|
| A-3 % | $15.000 | $0 si el vendedor cubre 3 %; hasta $15.000 si no ofrece nada | Ninguna por precio: es una tasa tradicional. Diferencia por **servicio humano + tecnología** |
| A-2,5 % | $12.500 | Faltante menor | Leve |
| A-2 % | $10.000 | Faltante menor; la oferta pide 1 % menos al vendedor, **$5.000 más competitiva** | Real: mejora la oferta del comprador |

**Lectura:**
- En A, el 3 % **no contradice** la misión, porque Lixtara no fija la comisión del lado vendedor de ese listing. Pero **tampoco la refuerza**.
- El ahorro del comprador solo se materializa si él paga parte de la compensación o si una tasa menor hace más competitiva su oferta.
- **Recomendación:** mantener 3 % como propuesta (decisión del owner) y **medir** la tasa efectiva cobrada, las negociaciones a la baja y los rechazos.
- Si los datos muestran resistencia, probar **2,5 %** como propuesta web.

#### Escenario B: Lixtara en ambos lados (decisión del owner: B2 por plan, sujeta a abogado)

**Política propuesta (B2 diferenciado por plan)**
- Aplica **solo** cuando Lixtara interviene legítimamente en ambos lados **y** las dos partes aceptaron por escrito.
- **Fórmula:** listing del plan + **1,5 % del lado comprador**.

| Plan | Listing (contrato del vendedor, sin cambios) | Lado comprador (solo en listings propios) | Total máximo de Lixtara |
|---|---|---|---|
| Essentials ($199) | 0,5 % | 1,5 % | **2 %** + $199 |
| Pro ($495) | 1 % | 1,5 % | **2,5 %** + $495 |
| Concierge ($995) | 1,5 % | 1,5 % | **3 %** + $995 |

**Reglas**
- **El 1,5 % es exclusivo de los listings propios.** No cambia las alternativas 2 / 2,5 / 3 % para propiedades de terceros (escenario A).
- **La comisión del listing es una obligación independiente.** No se modifica salvo enmienda escrita y validada. **Los contratos existentes no cambian automáticamente.**
- **Quién paga el 1,5 %** se define por escrito antes del tour:
  - el vendedor, si su listing ofrecía compensación al agente del comprador;
  - y/o el comprador.
  - No se asume que pague siempre uno ni que nunca pague el otro.
- **La suma recibida por Lixtara de todas las fuentes ≤ el total contractual permitido.**
- **El 6 % no se presenta** como tarifa universal ni legal. Las comparaciones de ahorro se hacen contra **alternativas concretas y verificables** (ver abajo) e **incluyen el fee fijo del plan**.

**Ahorro "real y verificable" (principio del owner)**
- **La comparación honesta es contra B0:** el mismo listing de Lixtara vendido a un comprador con agente externo que cobra lo que el vendedor ofreció en `buyer_agent_commission`.
- **Ahorro verificable** = (compensación ofrecida al agente del comprador − 1,5 %) × precio, cuando la paga el vendedor.
- **Si el vendedor ofrecía ≤ 1,5 %, no hay ahorro adicional.** No se debe anunciar uno.

**Ingreso bruto de Lixtara con B2 (incluye el fee del plan)**

| Precio | Essentials (2 %) | Pro (2,5 %) | Concierge (3 %) |
|---|---|---|---|
| $300.000 | $6.199 | $7.995 | $9.995 |
| $500.000 | $10.199 | $12.995 | $15.995 |
| $700.000 | $14.199 | $17.995 | $21.995 |
| $1.000.000 | $20.199 | $25.495 | $30.995 |

**Ahorro verificable para el vendedor**
- Supuesto ilustrativo: el vendedor ofrecía **2,5 %** al agente del comprador. B2 lo deja en 1,5 %, **1 % menos**, en cualquier plan.

| Precio | Ahorro frente a B0 |
|---|---|
| $300.000 | $3.000 |
| $500.000 | $5.000 |
| $700.000 | $7.000 |
| $1.000.000 | $10.000 |

**Topes fijos alternativos (comparación pedida; no elegidos)**
- **2 % para todos:** deja un lado comprador de 1,5 / 1 / 0,5 % según el plan. Con Concierge el lado comprador queda en 0,5 %: poco sostenible.
- **2,5 % para todos:** lado comprador de 2 / 1,5 / 1 %. Penaliza a Concierge y premia a Essentials.
- **3 % para todos:** lado comprador de 2,5 / 2 / 1,5 %. Más ingreso, menos ahorro y se acerca a "redistribuir".
- **El tope por plan** mantiene constante el lado comprador (1,5 %) y deja que el total refleje el servicio que eligió el vendedor. Es el más fácil de explicar.

**Comprador sin representación en un listing propio (B4)**
- **Florida no obliga** al comprador a contratar representación.
- La NAR no exige acuerdo escrito al agente que **da acceso a un comprador no representado en nombre del vendedor**.
- **Lixtara actúa solo para el vendedor:**
  - divulgación de "no brokerage relationship" al comprador, si corresponde;
  - **sin prestar servicios de representación al comprador.**
- **Costo para el vendedor:** listing del plan + fee. No se paga lado comprador, salvo lo que el listing agreement diga sobre compensación ofrecida.
- **Por confirmar con el abogado:**
  - qué relación tiene hoy Lixtara con el vendedor en su listing agreement;
  - qué divulgación exige Florida ante un comprador no representado.

**Rentabilidad neta: marco (todo hipótesis hasta medir)**
- **Fórmula:** neto por operación = ingreso bruto − split del asociado (etapa 2) − referral fee (si aplica) − costos directos (coordinación de transacción, E&O, herramientas, desplazamientos) − tiempo de Ana María (horas × costo imputado) − **costo de adquisición** por comprador cerrado.
- **Ilustración con hipótesis explícitas:**
  - costos directos de **$1.500** por cierre;
  - **30 h** de Ana María × **$75/h**, es decir **$2.250**;
  - CAC de **$0** (orgánico) a **$2.000**;
  - split de asociado del **0 %** (Ana María) o **40 %** (etapa 2).
- **A-3 % en $500k** (bruto $15.000):
  - con Ana María: neto **$9.250 a $11.250**;
  - con asociado al 40 %: neto **$3.250 a $5.250**.
- **B2-Pro en $500k:**
  - ingreso **incremental del lado comprador**: $7.500, sobre un listing que ya pagaba 1 % + $495;
  - costos solo de atender al comprador (la comercialización ya está cubierta);
  - neto incremental de **$1.750 a $3.750**.
- **Lectura:** en B2 el lado comprador es **rentable solo si el tiempo de atención es bajo**. Con un split del 40 % y CAC, el 1,5 % queda cerca del punto de equilibrio. **Hay que medir las horas reales** antes de delegar los B2 a asociados.

---

## 9. Showing Agreement de Lixtara (activo propio, revisado por abogado)

**Decisión del owner:** documento propio, sujeto a revisión y aprobación de un abogado inmobiliario de Florida. Sin versión definitiva todavía.

### Bases
- NAR Policy 8.13, F.S. cap. 475 (475.278 y la divulgación aplicable a transaction broker) y las reglas MIAMI MLS 2026 (P6).
- **Se compara la estructura** con los formularios de Florida Realtors (Showing Agreement, Pre-Touring, Exclusive) **sin copiar contenido** ni asumir derechos de uso.

### Partes
- **Comprador(es)** y **Lixtara LLC (CQ1075352)**, a través de su broker Anamaria Velasquez (BK3664191).
- **Por confirmar con el abogado:**
  - la capacidad de Ana María para firmar por la LLC (¿es la broker calificadora, miembro o gerente?);
  - si los asociados futuros pueden firmar en nombre de la brokerage.

### Contenido mínimo (esqueleto, no redacción)
1. Propiedades identificadas (dirección y número MLS) y un anexo para agregar más.
2. **Duración corta**, por ejemplo 30 a 90 días, y período de protección post-vencimiento. **Ambos los decide el abogado.**
3. **Relación: transaction broker**, con sus deberes y la divulgación correspondiente.
4. **Servicios** incluidos (según el nivel elegido).
5. **Compensación:**
   - % fijo y determinable.
   - Aviso conspicuo de que **no está fijada por ley y es negociable**.
   - Fuentes posibles de pago (vendedor, listing broker, comprador).
   - **Tope total** desde cualquier fuente.
   - **Obligación máxima del comprador** y cómo se calcula.
   - Momento del pago (al cierre).
6. Qué pasa si no hay compra, si el comprador compra la propiedad sin Lixtara dentro del plazo, y la terminación anticipada.
7. **Declaración del comprador** sobre acuerdos con otros brokers. Si tiene uno exclusivo, no se firma.
8. Obligaciones del comprador: información veraz, aviso si trabaja con otro agente y asistencia a las visitas.
9. Firma electrónica (ESIGN/UETA), copia para el comprador y la contrafirma de la broker como aceptación.
10. Avisos legales: Fair Housing / Equal Housing, privacidad y consentimientos de contacto (TCPA / FTSA).

### Experiencia de firma
1. **Paso 1:** datos, franjas de horario, consentimientos y las dos preguntas clave.
2. **Paso 2: resumen en lenguaje claro.**
   - Propiedad, duración, relación, **tu compensación y tu obligación máxima**, con un ejemplo numérico ("en $500.000, 3 % = $15.000; si el vendedor cubre 2 %, tú pagarías hasta $5.000").
   - Cómo cancelar.
   - El resumen **no sustituye** la lectura del documento completo; hay un enlace para abrirlo antes de firmar.
3. **Salida siempre visible:** **"Prefiero hablar primero con Ana María"**, que crea el lead sin firma.
4. **DocuSign:** reutiliza `src/lib/docusign.ts` con una plantilla nueva. Firma el comprador y luego la broker.
5. **Confirmación:** "Ana María te contactará en menos de 24 h." **No confirma la visita.**
6. **Ana María contrafirma**, coordina con el listing agent y confirma la visita a mano.
7. **Antes de cada oferta:** la hoja de verificación de compensación (§ 8).

### Si el comprador ya tiene representación
- **Acuerdo exclusivo con otro broker:** no se firma ni se agenda. Se sugiere contactar a su agente (Código de Ética, art. 16) y se registra el motivo.
- **Acuerdo no exclusivo:** se declara, se advierte el riesgo de **doble obligación de pago** y Ana María decide.

### Lista de decisiones para el abogado
1. Plantilla propia frente a riesgo de similitud con los formularios de Florida Realtors.
2. Capacidad de firma por Lixtara LLC (Ana María y futuros asociados).
3. Texto y ubicación de la divulgación de transaction broker; consentimiento si después se pasa a single agent.
4. Duración, período de protección y terminación.
5. Redacción del tope "de cualquier fuente" y de la obligación máxima del comprador.
6. Mecánica del faltante: el comprador paga, se pide en la oferta, o Lixtara reduce por escrito. Interacción con préstamos (FHA, VA, convencional).
7. Destino de la compensación del vendedor que exceda lo pactado (decisión comercial separada).
8. Si es válido un "tour" virtual en vivo y las visitas a open houses sin acuerdo.
9. Requisitos de las reglas MIAMI MLS 2026.
10. Consentimientos de contacto (TCPA y Florida Telemarketing Act) y privacidad de los datos del lead.
11. Convivencia con un acuerdo exclusivo posterior (B) y cómo sustituirlo.
12. Referidos a otras brokerages: acuerdo de referido y consentimiento del comprador para compartir datos.
13. **Escenario B2:**
    - ¿Puede Lixtara LLC actuar como transaction broker para ambas partes?
    - Divulgaciones y conflictos de interés.
    - Cláusula en el listing agreement y en el Showing Agreement (1,5 % del lado comprador, total por plan).
    - Enmiendas a los listing agreements existentes.
    - Tope "de cualquier fuente".
14. **Escenario B4:**
    - Relación actual de Lixtara con el vendedor en el listing agreement (DocuSign).
    - Divulgación ante un comprador no representado.
    - Límites de lo que Lixtara puede hacer por ese comprador.
15. **Escenario A:**
    - Instrumento escrito para reducir la comisión antes de la oferta.
    - Desglose firmado previo a la oferta.
    - Restricciones de préstamos cuando el comprador cubre la diferencia.
16. **Publicidad del ahorro** (61J2-10.025): comparaciones verificables, con el fee del plan incluido y sin presentar el 6 % como tarifa universal.

---

## 10. Atención y modelo de datos de leads

### Etapa 1
- Todo lead se asigna a Ana María.
- Ella recibe un email y tiene su cola en `/admin/buyer-leads`.
- El comprador recibe una confirmación inmediata y un SLA de 24 h para la respuesta, por validar. No se promete la visita.

### Etapa 2
- Reasignación a Realtors asociados bajo la supervisión de Ana María.
- **Antes de delegar** hay que definir las relaciones de brokerage, la supervisión, las licencias y el reparto de comisiones.

### Datos (sin cuentas de agente)
- **`buyer_leads`:** ya existe; hay que revisar sus columnas antes de cambiarla. Se agregan:
  - `listing_key`;
  - `criteria`, con los criterios del usuario;
  - calificación: plazo, financiamiento, `needs_to_sell` y `other_agent_status`;
  - consentimientos con fecha;
  - `agreement_status` y el envelope de DocuSign;
  - `agreed_comp_pct`;
  - `status`;
  - `assigned_to` y `handled_by`.
- **`lead_assignees`:**
  - Nombre, contacto, licencia SL/BK, brokerage y su CQ.
  - Relación: `internal_associate` o `referral_partner`.
  - Activo.
  - **No supone que todos pertenezcan a la misma brokerage.**
- **`lead_events`:** historial de asignaciones y estados.
- **Frontera IA:** estas tablas nunca llegan a un modelo. Se agregan al test `ai-boundary`.

---

## 11. Decisiones operativas (bloque 6)

### D-Lanzamiento: lead estructurado primero, firma digital después
- **CTA:** **"Solicitar visita con Lixtara"**, no "Agendar", porque no hay confirmación automática.
- **La solicitud** crea un registro en `buyer_leads` con la ficha (`listing_key`), los datos de contacto y los consentimientos con fecha.
- **Asignación:** a Ana María, que recibe un email (Resend) y tiene su cola en `/admin/buyer-leads`.
- **Confirmación al comprador:** "Recibimos tu solicitud; {brokerFirstName} te contactará dentro del plazo publicado". **Nunca dice "visita confirmada".**
- **Antes de un tour que requiera acuerdo escrito,** Ana María:
  - verifica si el comprador ya tiene representación;
  - explica las condiciones económicas;
  - gestiona la firma por el **procedimiento vigente de la brokerage**.
- **Estados mínimos:**
  1. solicitud recibida
  2. contacto pendiente
  3. contactado
  4. acuerdo pendiente
  5. acuerdo firmado
  6. visita en coordinación
  7. visita confirmada
  8. completada
  9. cancelada
- **Regla dura:** **"visita confirmada" no se puede registrar** sin el cumplimiento contractual registrado: tipo de acuerdo, fecha y referencia, o una excepción documentada con motivo.
  - Se aplica en la base de datos con un trigger o check, no solo en la UI.
- **Preparado para DocuSign:** campos `agreement_*` y estados listos. El Showing Agreement propio **no se implementa** hasta que el abogado lo apruebe.
- **Asignación futura:** `lead_assignees` y `lead_events`, sin cuentas ni paneles.
- **Métricas:**
  - solicitudes;
  - tiempo hasta el primer contacto;
  - contactos efectivos;
  - acuerdos firmados;
  - visitas realizadas;
  - conversiones (oferta y cierre).
- **Bloqueos:**
  - Ninguna IA procesa contenido MLS sin autorización escrita de MIAMI.
  - La publicación de fichas MLS y del CTA queda sujeta a las reglas vigentes y a las confirmaciones pendientes con Benjamin (P4, P5 y P6).
  - **Ningún copy** de representación, comisión, rebate o beneficio económico sin el modelo contractual aprobado.

### D-Analítica: GA4 (vía GTM) + PostHog, con responsabilidades separadas
- **GA4:** marketing y adquisición (fuentes, campañas, SEO, Google Ads, conversiones de marketing).
- **PostHog:** producto (embudos, abandono, cohortes, feature flags y, más adelante, experimentos).
- **Reglas:**
  - **Un solo catálogo de eventos.** Se reutilizan los eventos `dataLayer` actuales (`src/lib/analytics.ts`).
  - Sin pageviews duplicados.
  - Los SDK solo se cargan tras el consentimiento de cookies no esenciales.
- **Embudos separados:**
  - **Comprador:** búsqueda → resultados → abrir ficha → solicitar visita → contacto efectivo → acuerdo firmado → visita realizada → cierre.
  - **Vendedor:** landing → planes → inicio de registro → contratación → listing creado → publicado → cierre.
- **Los eventos comerciales y los cambios de estado** se emiten desde el **servidor** (transiciones de `buyer_leads`, webhooks de Stripe y DocuSign), no desde clics.
- **Prohibido enviar:**
  - datos personales identificables;
  - datos sensibles;
  - documentos;
  - **contenido MLS** (textos, imágenes, direcciones, URLs de fichas).
- **PostHog:**
  - **autocapture desactivado** en las páginas con contenido MLS;
  - **grabación de sesión desactivada** (o con enmascaramiento total) hasta validar con MIAMI;
  - las URLs se normalizan sin identificadores de ficha.
- **Dashboards:** adquisición, conversión por embudo, calidad del lead y tiempos de respuesta de Ana María.
- **Experimentos A/B:** no se activan hasta tener volumen suficiente. Primero, instrumentación confiable.

---

## 12. Ejecución al aprobar este plan (solo documentos, sin código)

**Alcance de la aprobación:** **solo** crear la carpeta y los documentos de abajo.
- No se modifica código, landing, `CLAUDE.md`, migraciones, contratos ni configuración.
- No se hace commit salvo que el owner lo pida.
- Cualquier implementación requiere **otra autorización expresa**.

**Carpeta:** `docs/planning/2026-10-compradores/`

| Archivo | Contenido |
|---|---|
| `00-plan-maestro.md` | Este documento |
| `01-email-miami-benjamin.md` | Anexo A |
| `02-brief-abogado.md` | Anexo B |
| `03-copy-seccion-compradores.md` | Anexo C |
| `04-roadmap.md` | Anexo D |

**Verificación de consistencia** (después de escribir, con grep sobre la carpeta):
1. El 0,5 / 1 / 1,5 % aparece solo en el contexto de listings.
2. El 2 / 2,5 / 3 % aparece solo en buyer brokerage.
3. El 1,5 % del lado comprador aparece solo en el escenario B2.
4. No hay "rebate" como oferta vigente.
5. No hay promesas de "el vendedor paga" ni "el comprador nunca paga".
6. No hay afirmaciones de autorización de MIAMI.
7. El nombre de la broker aparece solo como `{brokerFirstName}` en el copy, o como "Anamaria Velasquez" en los documentos legales.
8. No hay guiones largos en el copy público.

---

---

## 13. Bloqueos para pasar a implementación

**MIAMI (Benjamin), por escrito:**
- **P1:** asesor IA con parser ciego. **Bloquea V2.3.**
- **P2:** contenido pegado por el consumidor. Bloquea V2.3.
- **P3:** alertas por email. Bloquea V2.4 y el contenido del email de confirmación.
- **P4:** CTA de visita y registro en fichas de terceros. **Bloquea la activación de M3.**
- **P5:** campos del detalle y mapa. **Bloquea la activación de M2** y el mapa de V3.
- **P6:** texto de las MIAMI MLS Rules 2026.

**Abogado de Florida:**
- Verificación de Lixtara LLC y de la capacidad de firma de la broker.
- Las 16 cuestiones del Anexo B.
- Texto de los consentimientos (TCPA/FTSA) y de la privacidad.
- Revisión del copy público.
- Bloquea **V2.1, V2.2, V2.5 y V2.6** y los consentimientos de M3.

**Owner:**
- Encender la exhibición (M1).
- Aprobar el copy C.1 y C.2.
- Aprobar las migraciones de M3 y M4.
- Publicar el SLA de respuesta tras validarlo con la broker.


### Fuentes
- [NAR · Written buyer agreements 101](https://www.nar.realtor/the-facts/written-buyer-agreements-101)
- [NAR · MLS Policy 8.13](https://www.nar.realtor/handbook-on-multiple-listing-policy/no-compensation-offers-in-mls-section-4-written-buyer-agreements-required-policy-statement-8-13)
- [Florida Realtors · NAR Settlement FAQs](https://www.floridarealtors.org/law-ethics/nar-settlement-faqs)
- [Florida Realtors · Settlement forms](https://floridarealtors.org/law-ethics/nar-settlement-sitzer-burnett-lawsuit)
- [F.S. 475.278 (2025)](https://www.flsenate.gov/Laws/Statutes/2025/475.278)
- [FAC 61J2-10.028](https://www.law.cornell.edu/regulations/florida/Fla-Admin-Code-Ann-R-61J2-10-028)
- [MIAMI · 2026 Code of Ethics / MLS Rules update](https://www.miamirealtors.com/wp-content/uploads/bsk-pdf-manager/2025/12/2026-Changes-Coming-to-the-Code-of-Ethics-MLS-Rules_Legal-Update.pdf)
