# MIAMI AOR — Broker 2024 Member Data License Agreement (No Third Party Vendor)

**Analizado:** 2026-09-03 · **Documento:** `agreement-c02e588c-9ea1-4730-9a7c-7b537d49b270.pdf`, 25 págs
**Estado:** MLS **Agreed** (automático, 2026-09-03) · BROKER **Waiting** — Anamaria Velasquez, Lixtara, LLC.
**Versión de términos:** 2024 MIAMI AOR Data License Agreement, actualizado 2024-05-14

> ⚠️ **Esto es un análisis de ingeniería y de riesgo operativo, no asesoría legal.** Los puntos
> marcados 🔴 deberían pasar por un abogado de real estate de Florida antes de firmar.

---

## Veredicto

**Es el acuerdo correcto.** Cubre los cinco tipos de feed y, según §II.C, sirve **tanto para
Trestle (CoreLogic) como para Bridge Interactive** — así que firmarlo no te obliga a elegir
proveedor ahora.

**Pero hay tres cosas que no están OK tal como está el producto hoy**, y una de ellas invalida
el plan F3 que teníamos escrito.

---

## 🔴 1. La prohibición de IA choca de frente con Lixtara

**§III.B.4** — literal:

> *"Feed license Licensed Content, directly or indirectly, **to any generative artificial
> intelligence model ("AI")**, including but not limited to image recognition technology, ...
> language translation programs, ... logical AI programs, **and/or chatbots**, for any purpose,
> including but not limited to **machine processing**, machine learning, machine perception,
> machine control, **training, harvesting**, or incorporating the same into any third-party
> products and services"*

Esto prohíbe pasar contenido del MLS a **cualquier** modelo de IA generativa, para **cualquier**
propósito. No es una cláusula de "no entrenes modelos": dice *machine processing* y *chatbots*.

**Qué rompe hoy:**

| Componente | Riesgo |
|---|---|
| **Loui** (`/api/loui`, Anthropic) | Es literalmente un chatbot. Si alguna vez recibe una ficha del MLS en su contexto, es incumplimiento. |
| **Recomendación de precio con IA** | El plan F3.3 documentado dice: *"Use MLS feed para train price recommendation model → blend MLS + Anthropic"*. **Eso es incumplimiento directo.** Hay que tacharlo del plan. |
| **Media Intelligence Agent** (Claude Vision) | Si alguna vez clasifica fotos que vengan del feed, incumple. Hoy solo toca fotos del vendedor — mantenerlo así. |
| **Staging IA** (Luma) | Igual: solo fotos propias del vendedor, nunca imágenes del `Media` del MLS. |

**Qué hacer, en arquitectura:** frontera dura. El contenido MLS vive en `mls_listings` y **jamás
entra en un prompt**. Ninguna función que llame a Anthropic, Gemini o Luma puede leer de esa
tabla. Esto se puede hacer cumplir con un test que falle si algún módulo bajo `lib/ai*`,
`loui-prompt`, `media-intelligence` o `staging` importa el módulo de MLS.

🔴 **Para el abogado:** ¿los comps del paso 3 —que son análisis de mercado para el propio
vendedor— caen bajo §III.B.15 *"benchmarking or competitive analysis"*? Es el uso clásico de
IDX/VOW, pero la redacción es amplia.

---

## 🔴 2. Garantizas accesibilidad ADA que nunca has auditado

**§VII.B.1**:

> *"Technology Provider warrants that the Website shall at all times comply with all applicable
> federal, state, and local fair housing and disability laws, including ... the Americans with
> Disabilities Act. Technology Provider further warrants that the Website, **at all times, shall
> be accessible to individuals with disabilities**."*

Y **§VII.D.1** te obliga a indemnizar a MIAMI por reclamaciones de ADA y fair housing.

Lixtara **nunca ha hecho una auditoría de accesibilidad**. Esto pasa de "buena práctica" a
**garantía contractual con indemnización**. Nota relacionada ya documentada: los tours 3DGS son
opacos para lectores de pantalla.

**Antes de activar el feed:** auditoría WCAG 2.1 AA de las superficies públicas (`/properties`,
`/property/[id]`, landing) y plan de remediación.

---

## 🔴 3. No existe el agente DMCA, y es requisito previo

**§VII.B.2** exige que el sitio incluya:
- Divulgaciones DMCA
- Procedimiento de reporte y retirada (*takedown*)
- **Nombre, dirección, email y teléfono de un agente designado registrado**

*(El acuerdo dice "USPTO"; el registro real de agentes DMCA es de la U.S. Copyright Office —
error de redacción de ellos, la obligación de fondo es la misma.)*

Lixtara **no tiene nada de esto**. El registro cuesta ~$6 y toma minutos, pero hay que hacerlo.
Además: al recibir un takedown hay que **reenviarlo a MIAMI en 24 h** a `legal@miamire.com` y
`dmca@miamire.com`.

---

## Obligaciones operativas continuas

### Reportes trimestrales — con multa diaria por incumplir

**Schedule B §3:** dentro de los **10 días** del cierre de cada trimestre (**10 abr · 10 jul ·
10 oct · 10 ene**) hay que enviar a MIAMI un informe escrito con *websites, subdominios,
direcciones IP, etc.*, en el formato vigente publicado.

**§VIII.D:** hay **multas diarias** por no entregarlos, y el incumplimiento suspende el feed.
Alguien tiene que ser dueño de esta tarea recurrente.

### Un solo sitio web — y los previews de Vercel son un problema

**§IX.J:** *"...place the Licensed Content on **one (1) single Website**, specifically named in
this Agreement."*
**Schedule B §1:** *"**This is the ONLY Website authorized to receive the Data Feed.**"*
**Schedule B §2:** los subdominios deben **declararse**; no cobran hoy pero se reservan el
derecho. *"Failure to disclose the subdomains is a **material breach**."*

Lixtara despliega en `lixtara.com`, mantiene el alias `lixtara.vercel.app`, y **cada PR genera un
preview `lixtara-*.vercel.app`**.

**Regla de ingeniería obligatoria:** el feed se declara para **`lixtara.com` únicamente**, y los
datos MLS **nunca** deben existir en Preview ni en Development. Gatear por `VERCEL_ENV === "production"`,
fail-closed, con el mismo patrón que ya usa `CREATIVE_STUDIO_VIDEO_ENABLED`.

### Refresco: 24 horas, no 15 minutos

**Schedule A §5** y **Schedule D §6.g:** refrescar *"not less frequently than every twenty-four
(24) hours"*. Corrige la nota anterior que decía 15 min — el mínimo contractual aquí es **24 h**.
Más frecuente está permitido.

### Obligación activa de impedir scraping

**Schedule A §1:** hay que *"employ reasonable efforts to **monitor for and prevent 'scraping'**"*
del contenido en tu propio sitio. No es pasivo. Vercel BotID + rate limiting en las rutas públicas
de listings sería la respuesta natural.

### Al terminar: destruir todo, incluidos backups, en 10 días

**§VI.C:** al terminar el acuerdo hay que *"remove and destroy any copies of the Licensed Content
in its possession (**including backups**)"* y **confirmarlo por escrito en 10 días**.

**Consecuencia de arquitectura:** confirma la decisión de **no meter datos MLS en `properties`**.
Tabla `mls_listings` separada, purgable, con runbook de borrado documentado que contemple los
backups PITR de Supabase.

---

## Textos que hay que mostrar sí o sí

**Atribución por listing ajeno** (Schedule A §9 / Schedule D §6.d) — para listings que no son de
tu correduría:

> `This listing is courtesy of {nombre de la firma}.`

Tipografía del **tamaño promedio** usado en la ficha, **nunca menor que la mediana**, color
legible y ubicación razonablemente prominente. Más los campos extra de atribución (teléfono de
oficina, email, teléfono/email del agente listador) **si la correduría listadora los seleccionó**.

**Aviso de copyright** (Schedule A §10 / Schedule C §3) — literal:

> `Copyright Southeast Florida Multiple Listing Service © YYYY` *(o `Copyright SEFMLS © YYYY`)*.
> `Accuracy of listing information is not guaranteed. Listing information is provided for personal
> consumer, non-commercial use, solely to identify potential properties for potential purchase.
> All other use is strictly prohibited, is a violation of the terms of use, and may violate
> federal and state law.`

**Disclaimer de fiabilidad** (Schedule C §2): aviso de que la MLS Data *"is deemed reliable, but
is not guaranteed accurate by MIAMI REALTORS®"*.

Nada de esto existe hoy en el sitio.

---

## Otras prohibiciones que rozan el producto

| § | Prohibición | Dónde roza |
|---|---|---|
| III.B.8 | Filtrar o restringir listings **según la compensación ofrecida al broker cooperante** | Tu calculadora de rebate y `buyer_agent_commission`. **No permitas filtrar/ordenar listings del MLS por comisión.** Tus propios listings no son Licensed Content. |
| III.B.7 | Crear un mecanismo no-MLS de ofertas de compensación a buyer brokers | El vendedor elige `buyer_agent_commission` en el wizard. Para listings propios probablemente esté bien, pero 🔴 revísalo con abogado — es terreno sensible post-acuerdo NAR. |
| III.B.15 | Benchmarking o análisis competitivo | El panel de comps. Ver punto 1. |
| Sched. A §2 / §IV.E | Usar la data para **contactar** a participantes de MIAMI, incluido marketing y reclutamiento | `agent_partners` y `buyer_leads`. **No siembres esas tablas desde el roster del MLS.** |
| III.B.9 / .10 | Descargar, exportar, transmitir, sublicenciar o dar acceso a terceros | Nada de exponer el feed por API propia, ni compartirlo con un vendor. |
| Sched. A §3-4 | No mostrar listings cuyo vendedor retiró permiso de internet | El feed ya los excluye (§II.E.6), pero hay que honrarlo. |

**Cobertura incompleta** (§III.G, en mayúsculas): *"THE LICENSED CONTENT DOES NOT INCLUDE ALL
BROWARD COUNTY MLS DATA."*

---

## ✅ RESPUESTAS DE MIAMI (Benjamin Costa, 2026-09-09)

Recibidas por correo. **Simplifican el plan y anulan dos obligaciones que había marcado.**

| Pregunta | Respuesta | Efecto |
|---|---|---|
| 1 · ¿IDX Plus permite mostrar vendidos públicamente? | *"With IDX, it contains every active, active with contract, pending, coming soon listings, and any other IDX Opt In Listings **+ 7Yrs Sold**. Sold/closed listings **may be displayed to anyone** as it is for public facing client search."* | **El feed IDX ya trae 7 años de vendidos y se pueden mostrar en público.** Los comps no necesitan estar detrás de login. |
| 2 · ¿Necesitamos IDX aparte de IDX Plus? | *"You would need IDX if you would like the information above"* | **Un solo feed cubre todo.** IDX Plus deja de ser necesario. |
| 3 · ¿$100 o $1.000 por feed adicional? | *"First IDX feed is completely free... After that its **$100 per year up to 5 feeds**. If you would like more than 5 feeds it would be $1000"* | Confirma el cuestionario del acuerdo. La instrucción de Bridge que decía $1.000 estaba desactualizada. |
| 4 · ¿Hay que declarar entornos no públicos? | *"They do not have to be declared. Yes."* | No hay que declarar previews. Y confirma que **restringir el feed a producción es el enfoque correcto**. |
| 5 · Formato del Quarterly Report | *"Quarterly reports are only for **vendors servicing agents**."* | **No aplica a Lixtara** (es su propio Technology Provider, sin clientes terceros). Se cae la obligación trimestral y sus multas diarias. |
| 6 · Cobertura | *"all the data that Miami MLS has as well as **Beaches MLS**... includes any out of area listings that may be global."* + [mapa de cobertura](https://www.miamirealtors.com/wp-content/uploads/bsk-pdf-manager/2020/07/MLS-Coverage-Area-Maps.pdf) | Mucho más amplia de lo previsto. Beaches MLS cubre Broward y Palm Beach. |
| 7 · Bridge vs Trestle | *"Both providers have the **exact same feeds**, **Trestle might have additional charges** to hold an account and feed that may not make it free."* | **Bridge, decidido.** Mismos datos, y Trestle puede romper la gratuidad. |

### ⚠️ Tres respuestas contradicen el texto firmado

Esto no invalida las respuestas, pero hay que cerrarlo por escrito antes de firmar.

| Tema | Dice el acuerdo | Dice el staff |
|---|---|---|
| Contenido de IDX | §II.E.1: *"Licensed Content for an IDX Data Feed means **only active** listing information"*. Los vendidos + 7 años están en **IDX Plus** (§II.E.2). | IDX trae 7 años de vendidos |
| Reportes trimestrales | Schedule B §3 obliga al *Technology Provider*, sin excepción visible | Solo para vendors que atienden agentes |
| Subdominios | Schedule B §2: no declararlos es **incumplimiento material** | No hay que declararlos |

**§IX.I: el acuerdo no puede enmendarse salvo por escrito firmado por todas las partes.** Un
correo de staff no es una enmienda, y §VI.B.7 permite a MIAMI terminar **a su sola discreción**
si estima que se violó una Regla.

**Hipótesis más probable:** lo que MIAMI *aprovisiona* comercialmente como "IDX" corresponde a lo
que los Schedules llaman **IDX Plus**. Si es así, basta marcar la casilla correcta en *Types of
Data Feeds* para que el papel coincida con la realidad. **Hay que confirmarlo antes de firmar.**

---

## Feeds — DECISIÓN FINAL (2026-09-15)

MIAMI cerró la pregunta: **«Select IDX, and the IDX feed would already cover your brokerage's
listings.»**

| Feed | Decisión | Por qué |
|---|---|---|
| **IDX** | ✅ **El único. Gratis.** | Activos + con contrato + pending + coming soon + **7 años de vendidos**, mostrables públicamente, **e incluye los listings de la propia correduría**. |
| Brokerage Only – PDAP | ❌ Ya no | MIAMI confirmó que IDX cubre los listings propios. Se ahorra el feed y sus $100. |
| IDX Plus · VOW · Broker Back Office | ❌ No | Innecesarios. |

**Costo total del feed: $0/año.**

**En el formulario, marcar únicamente `IDX`.**

### Rentcast se cancela

El panel de comps del paso 3 corre sobre **Rentcast a $99/mes = $1.188/año**, con precios
estimados y semanas de lag. El IDX trae precios reales de cierre, 7 años, gratis. Migrar
`src/lib/rentcast.ts` y cancelar la suscripción.

### ⚠️ Consecuencia que nadie ha levantado: hay que deduplicar

Si el IDX incluye los listings de la propia correduría, **cada propiedad de un vendedor de
Lixtara existirá dos veces**: como fila en `properties` (el registro propio, con sus fotos,
staging y video) y como ficha entrante del feed.

Sin deduplicar, `/properties` la muestra repetida.

**La clave natural ya está en el esquema:** `properties.mls_number` tiene constraint `UNIQUE`
(baseline `properties_mls_number_key`). La estrategia:

1. Al sincronizar, cruzar cada ficha del IDX contra `properties.mls_number`.
2. Si hay coincidencia → **renderizar desde `properties`**, que es más rica (fotos propias,
   staging IA, video de Creative Studio) y suprimir la copia del feed.
3. Si no hay coincidencia → es inventario de terceros; se muestra desde `mls_listings` con la
   atribución obligatoria *"This listing is courtesy of {firma}"*.

Esto además **cierra el hueco de `mls_number`**: el número llega por el feed y se escribe en la
fila propia al hacer el cruce — que era justamente para lo que se pensaba PDAP.

🔴 **Sigue abierto para el abogado:** §III.B.9 prohíbe *"download, distribute, export, deliver,
or transmit any of the Licensed Content ... **except Participant's Website**"*. Escribir el
`mls_number` en la base interna es **procesamiento**, no exhibición. A escala de piloto,
Anamaria puede registrarlo a mano desde Matrix y evitar la pregunta por completo.

## Campos en blanco y cómo llenarlos

| Campo | Valor |
|---|---|
| Designated REALTOR®/Broker | Anamaria Velasquez |
| License Number | *(la BK individual de ella, no la CQ)* |
| Brokerage | **Lixtara, LLC.** |
| **Technology Provider Company** | **Lixtara, LLC.** — §II.J define Technology Provider como *"any person or entity that creates and makes available ... a Website"*. Ustedes construyen y operan el sitio, así que son ambas partes. Por eso aplica la versión *No Third Party Vendor*. |
| Technology Provider Website | `https://lixtara.com` |
| Agent | Vacío (N/A) |
| **Schedule B §1 — Website Domain** | `lixtara.com` **y nada más** |
| **Schedule B §2 — Subdominios** | Declarar los que realmente sirvan contenido MLS. Si la regla de "solo producción" se cumple, **ninguno**. |

**Dato confirmado:** la razón social registrada es **"Lixtara, LLC."** — esto resuelve la duda
abierta del kit de marca sobre si el nombre registrado ante el DBPR coincide con la marca. Sí
coincide.

**Detalle menor:** el acuerdo escribe **"Anamaria"** (una palabra); el código usa **"AnaMaria"**.
Unificar en los documentos legales.

---

## Condiciones comerciales

- **Vigencia:** desde la Effective Date hasta el **31 de diciembre del mismo año**. Renovación
  automática por años calendario. **MIAMI puede ajustar tarifas cada año a su sola discreción.**
- **Pago:** por año calendario adelantado, vence **31 de enero**; si no, se termina el acuerdo.
  **Sin reembolsos de ningún tipo, prorrateados o no** (§VI.E, Schedule B §15).
- **Pagos van a Bridge o Trestle**, que remiten a MIAMI (Schedule B §10).
- **Acuerdo separado obligatorio con Bridge y/o Trestle** antes de activar el feed (§III.E,
  Schedule B §14), con sus propios *setup fees* y cargos mensuales.
- **Terminación inmediata (1 día hábil)** si MIAMI determina **a su sola discreción** que violaste
  cualquier Regla (§VI.B.7-8).
- **Las Reglas cambian sin aviso** y es tu responsabilidad monitorear `miamirealtors.com/mls`
  (§IV.A). Los Schedules A, C y D dicen lo mismo: las enmiendas futuras prevalecen.
- **Responsabilidad de MIAMI limitada** a las tarifas pagadas en el año previo — que con el feed
  de cortesía es esencialmente **cero**.
- **Renuncia a juicio por jurado** y **renuncia a acción colectiva**; mediación y foro en
  Miami-Dade, ley de Florida (§VIII.C, §IX.A).
- **No cesión sin consentimiento previo escrito de MIAMI** (§IX.G) — relevante ante una
  adquisición o reestructuración societaria.

---

## Checklist antes de que AnaMaria firme

**Bloqueantes técnicos:**
- [ ] Registrar agente DMCA + publicar página de DMCA con procedimiento de takedown
- [ ] Auditoría de accesibilidad WCAG 2.1 AA + plan de remediación
- [ ] Decidir y documentar la frontera dura MLS ⇄ IA (con test que la haga cumplir)
- [ ] Diseñar `mls_listings` separada + runbook de purga que contemple backups
- [ ] Gate de entorno: datos MLS solo en producción, nunca en Preview

**Bloqueantes de respuesta de MIAMI:**
- [ ] ¿IDX Plus permite mostrar ventas cerradas públicamente?
- [ ] ¿$100 o $1.000 por feed adicional? (discrepancia entre documentos)
- [ ] ¿Los previews de Vercel cuentan como subdominios a declarar?
- [ ] Formato exacto y plantilla del Quarterly Report

**Bloqueantes legales (abogado FL):**
- [ ] ¿Los comps del vendedor caen bajo "benchmarking or competitive analysis"?
- [ ] ¿La selección de `buyer_agent_commission` roza §III.B.7?
- [ ] Alcance real de la garantía ADA y la indemnización

**Operativo:**
- [ ] Asignar dueño de los Quarterly Reports (10 abr / 10 jul / 10 oct / 10 ene)
- [ ] Ejecutar el acuerdo separado con Bridge y/o Trestle
