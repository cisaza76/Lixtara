# Copy de la sección de compradores (EN / ES) · borrador

> Pendiente de aprobación del owner y revisión del abogado. No publicar.

**Reglas:**
- Sin porcentajes, rebate, devoluciones ni ahorros.
- Sin "AI-powered" mientras la IA no esté autorizada.
- Sin guiones largos.
- El nombre de la broker solo vía `{brokerFirstName}` (se llena desde `src/config/brokerage.ts`).
- **Borrador para aprobación del owner y revisión del abogado.**

## C.1 Sección de la landing (reemplaza "Buyer rebate program")

| Elemento | EN | ES |
|---|---|---|
| Eyebrow | For buyers | Para compradores |
| Título | Find your next home. We'll guide you every step of the way. | Encuentra tu próximo hogar. Te acompañamos en cada paso. |
| Texto | Search smarter with Lixtara and get personalized guidance from a real estate professional, from your first showing to closing. | Busca de forma más inteligente con Lixtara y recibe orientación personalizada de una profesional inmobiliaria, desde tu primera visita hasta el cierre. |
| Pilar 1 · título | Search that works for you | Una búsqueda a tu medida |
| Pilar 1 · texto | Filter homes across Miami-Dade, Broward and Palm Beach by price, bedrooms, bathrooms and location, on any device. | Filtra viviendas en Miami-Dade, Broward y Palm Beach por precio, habitaciones, baños y ubicación, desde cualquier dispositivo. |
| Pilar 2 · título | A real professional by your side | Una profesional real a tu lado |
| Pilar 2 · texto | {brokerFirstName}, our licensed broker, reviews your request personally and helps you with showings, offers and every step until closing. | {brokerFirstName}, nuestra broker licenciada, revisa tu solicitud personalmente y te ayuda con las visitas, la oferta y cada paso hasta el cierre. |
| Pilar 3 · título | Clear terms before you commit | Condiciones claras antes de comprometerte |
| Pilar 3 · texto | Before any showing that requires an agreement, we explain how our services and compensation work, and you decide. | Antes de cualquier visita que requiera un acuerdo, te explicamos cómo funcionan nuestros servicios y la compensación, y tú decides. |
| CTA principal | Explore Homes | Explorar viviendas |
| CTA secundario | Talk to {brokerFirstName} | Hablar con {brokerFirstName} |

## C.2 Ficha: botón y formulario "Solicitar visita"

| Elemento | EN | ES |
|---|---|---|
| Botón | Request a showing with Lixtara | Solicitar visita con Lixtara |
| Introducción | Tell us when you'd like to see this home. {brokerFirstName} will contact you to coordinate. This request does not confirm a showing. | Cuéntanos cuándo te gustaría ver esta vivienda. {brokerFirstName} te contactará para coordinar. Esta solicitud no confirma la visita. |
| Campos | Full name · Email · Phone (optional) · Preferred days and times · Questions (optional) | Nombre completo · Email · Teléfono (opcional) · Días y horarios preferidos · Preguntas (opcional) |
| Pregunta | Have you signed an agreement with another real estate agent? Yes, exclusive · Yes, not exclusive · No · Not sure | ¿Firmaste un acuerdo con otro agente inmobiliario? Sí, exclusivo · Sí, no exclusivo · No · No estoy seguro |
| Pregunta opcional | Do you need to sell a home before buying? Yes · No · Maybe | ¿Necesitas vender una vivienda antes de comprar? Sí · No · Tal vez |
| Consentimiento (obligatorio) | I agree that Lixtara may contact me by email or phone about this request. *(pendiente de abogado)* | Acepto que Lixtara me contacte por email o teléfono sobre esta solicitud. *(pendiente de abogado)* |
| Consentimiento (opcional) | Send me marketing messages and new listings by text or phone. Consent is not a condition of purchase. *(texto TCPA/FTSA del abogado)* | Envíame mensajes de marketing y nuevas propiedades por texto o teléfono. El consentimiento no es condición de compra. *(texto TCPA/FTSA del abogado)* |
| Enviar | Send request | Enviar solicitud |
| Confirmación | Request received. {brokerFirstName} will contact you within [plazo publicado]. Your showing is not confirmed yet. | Solicitud recibida. {brokerFirstName} te contactará dentro de [plazo publicado]. Tu visita aún no está confirmada. |
| Si hay acuerdo exclusivo | Thanks for letting us know. Since you have an exclusive agreement with another agent, please contact them to see this home. | Gracias por avisarnos. Como tienes un acuerdo exclusivo con otro agente, contáctalo para ver esta vivienda. |

## C.3 Email de confirmación al comprador

**EN**
- **Subject:** We received your showing request
- **Body:** Hi [name], thanks for your interest in [address]. {brokerFirstName}, our licensed broker, will contact you within [plazo publicado] to coordinate. Your showing is not confirmed until she confirms it with you.

**ES**
- **Asunto:** Recibimos tu solicitud de visita
- **Cuerpo:** Hola [nombre], gracias por tu interés en [dirección]. {brokerFirstName}, nuestra broker licenciada, te contactará dentro de [plazo publicado] para coordinar. Tu visita no está confirmada hasta que ella la confirme contigo.

**Pie de ambos:** `brokerageLicenseLine(lang)`

**Pendiente de MIAMI (P3/P5):** si el email puede llevar la dirección y la foto de la ficha, o solo un enlace.

---
