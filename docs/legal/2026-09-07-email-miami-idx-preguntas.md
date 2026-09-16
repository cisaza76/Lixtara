# Respuesta a MIAMI — IDX data feed (borrador para enviar)

**Para:** MIAMI MLS IDX (responder al hilo original) · con copia a `MLSIDX@miamire.com`
**De:** Camilo Isaza
**Asunto sugerido:** `IDX data feed — Lixtara, LLC (Brokerage Lic. CQ1075352) — feed types and clarifications before signature`

---

Hello,

Thank you for the information.

Some context so you can point us to the right setup: **Lixtara, LLC** is a licensed Florida
brokerage (Lic. **CQ1075352**); **Anamaria Velasquez** is our Designated Broker. We build and
operate our website (**lixtara.com**) **in-house** — we do not use an outside webmaster or a
third-party vendor — so we are proceeding under the **Member Data License Agreement – No Third
Party Vendor**, listing Lixtara, LLC as both Participant and Technology Provider. Our agreement
(`c02e588c-9ea1-4730-9a7c-7b537d49b270`) is already in the Bridge dashboard awaiting our
broker's signature.

We plan to consume the feed **server-side via the RESO Web API** and display Licensed Content on
a **single website, lixtara.com**. Based on the agreement, we believe we need three feed types:

- **IDX** — active listings for our public search and detail pages
- **IDX Plus** — sold data, for the comparable-sales analysis we show our seller clients
- **Brokerage Only – PDAP** — our own listings, to reconcile MLS numbers and status back into
  our system

Before our broker signs, we would appreciate written clarification on six points:

**1. IDX Plus display rules.** May sold/closed listing data received through IDX Plus be
displayed publicly, or must it be shown only to authenticated users with whom we have first
established a broker-consumer relationship? This determines how we build our seller
comparable-sales tool.

**2. Overlap between IDX and IDX Plus.** Section II.E.2 defines IDX Plus as including active
listings. Do we still need a separate IDX feed for our public pages, or does IDX Plus cover both
uses?

**3. Fees for additional feed types.** The Member Courtesy Data Feed Questionnaire in the
agreement states **$100 annually** per additional feed type (up to five). The Bridge sign-up
instructions we received state **$1,000 annually**. Which applies to IDX Plus and to PDAP?

**4. Subdomains and non-public environments.** Schedule B §2 requires disclosure of subdomains,
and non-disclosure is a material breach. Our production site is **lixtara.com**. During
development we also use temporary, non-public deployment URLs that would **not** display
Licensed Content. Do those need to be declared, and is restricting the Data Feed to the
production site only the correct approach?

**5. Quarterly Reports.** Could you send the current form or template required under Schedule B
§3, and confirm where it should be submitted?

**6. Coverage.** Could you confirm the geographic coverage of the feed — specifically
Miami-Dade — and the extent of the Broward County limitation noted in Section III.G?

Finally, we are evaluating **Bridge** and **Trestle**. Since Trestle is broker-only and we
qualify, we would like to know whether **both providers deliver all three feed types above**, or
whether one is preferred for this combination.

Thank you for your help.

Camilo Isaza
Lixtara, LLC — Licensed Florida Brokerage, Lic. CQ1075352
lixtara.com

---

## Notas para Camilo (no enviar)

**Por qué NO pregunto sobre IA.** El §III.B.4 ya prohíbe por escrito alimentar contenido del MLS
a cualquier modelo de IA. Preguntarlo no cambia la respuesta y solo deja constancia de que
teníamos la intención. La solución es arquitectónica: frontera dura entre `mls_listings` y todo
lo que llame a Anthropic, Gemini o Luma.

**Por qué NO pregunto sobre "benchmarking".** La pregunta 1 obtiene lo que necesitamos
—si podemos mostrar comps de ventas cerradas al vendedor autenticado— sin invitar a una
interpretación restrictiva del §III.B.15. La lectura fina de esa cláusula es para el abogado.

**Lo que hay que tener listo antes de que Anamaria firme** (independiente de esta respuesta):
agente DMCA registrado + página de takedown · auditoría de accesibilidad WCAG 2.1 AA · gate de
entorno para que los datos MLS solo existan en producción.
