import type { LegalContent } from "./types";
import { PRIVACY_PROVIDERS, providerBullet } from "./providers";

// Política de Privacidad. BORRADOR 2026-10 para revisión del abogado de Lixtara: no es un
// texto final y no afirma que Lixtara cumpla una ley determinada. Las dudas van marcadas
// [VERIFICAR: …] y quedan visibles hasta la revisión.
// Marcadores ({legalName}, {brokerageAddress}, {privacyEmail}, …): src/lib/legal/config.ts.
// La lista de proveedores (4.1) se genera de src/lib/legal/providers.ts.

export const privacyDoc: LegalContent = {
  en: {
    title: "Privacy Policy",
    intro: [
      "This Privacy Policy explains how {legalName} (\"Lixtara,\" \"we,\" \"us\") collects, uses, shares and protects personal information when you use lixtara.com and our related services (the \"Service\"). Lixtara is a licensed Florida real estate brokerage (FL #{brokerageLicense}) located at {brokerageAddress}.",
      "Please read it together with our Terms of Service and our Cookie Policy. If you do not agree with this Policy, please do not use the Service.",
    ],
    sections: [
      {
        heading: "1. Who We Are and What This Policy Covers",
        body: [
          "This Policy applies to personal information we collect through the Service: the public website, the seller listing flow, the seller dashboard and account area, buyer tools (offers, saved homes and showing requests), the Loui AI assistant, virtual staging and listing media features, and the emails we send.",
          "It does not cover websites or services run by others, even if we link to them, such as the pages where Stripe processes payments or where DocuSign collects signatures. Those companies handle your information under their own policies.",
          "\"You\" means anyone who uses the Service: sellers, buyers, visitors, and property owners we contact.",
        ],
      },
      {
        heading: "2. Information We Collect",
        body: ["We collect information you give us, information collected automatically when you use the Service, and information we receive from other sources."],
        sub: [
          {
            heading: "2.1 Information You Give Us",
            body: [],
            bullets: [
              "Account information: name, email address, phone number and password. Your password is stored by our authentication provider in a protected (hashed) form; we never see it in plain text.",
              "Listing information: the property address, unit, property facts, price, description, showing instructions, occupancy and tenant details, the buyer-agent compensation you choose, photos, videos and other files you upload.",
              "Agreement information: the details placed in your listing agreement (for example, the legal description and folio number) and your electronic signature, which is collected by DocuSign.",
              "Payment information: the plan or service you buy and the payment status. Your card details are entered on Stripe's pages; Lixtara does not receive or store full card numbers.",
              "Buyer information: when you make an offer, request a showing or save a home, the contact details, offer terms, financing information and messages you provide. Offers and showing requests are shared with the seller of that home and with our broker.",
              "Communications: messages you send us through forms, email or the Loui assistant, and your choices about receiving emails, calls or text messages.",
            ],
          },
          {
            heading: "2.2 Information Collected Automatically",
            body: [],
            bullets: [
              "Device and log information: IP address, browser and device type, operating system, pages requested and the date and time of each request. Our hosting provider keeps these records in its server logs.",
              "Usage information: pages and features you use and actions you take in the listing flow (for example, which step you completed), recorded without the text you type.",
              "Cookies and similar technologies: as described in Section 6 and in our Cookie Policy. Analytics tools run only if you accept analytics cookies.",
            ],
          },
          {
            heading: "2.3 Information From Other Sources",
            body: [],
            bullets: [
              "Public property records from the Miami-Dade County Property Appraiser, used to pre-fill property details.",
              "Estimated values and comparable sales from Rentcast, based on the property address.",
              "Listing information from the multiple listing service (MLS) of the MIAMI Association of REALTORS®, received through Bridge Interactive, including the name and contact details of the listing agent and office shown with each MLS listing.",
              "Prospecting data: to contact owners of properties in South Florida, we use public property records and contact details (such as email addresses) obtained from third-party data providers. [VERIFICAR: fuente de los datos de contacto, contrato con el proveedor y base para usarlos en correos de prospección.]",
            ],
          },
          {
            id: "consent-evidence",
            heading: "2.4 Records of Your Consent",
            body: [
              "When you accept our Terms (including the refund terms before paying), consent to electronic records and signatures, or agree to receive calls or text messages, we keep a record of that acceptance: the date and time, the version of the document, the language you saw it in, a cryptographic fingerprint (hash) of the exact text you accepted, your IP address and your browser's user-agent string.",
              "We use these records only to prove that the consent was given, to answer payment disputes (chargebacks) and to meet our legal and recordkeeping obligations. [VERIFICAR: plazo de conservación de estos registros.]",
            ],
          },
        ],
      },
      {
        heading: "3. How We Use Information",
        body: ["We use personal information to:"],
        bullets: [
          "Provide the Service: create and secure your account, build and publish your listing, prepare your listing agreement for signature, process payments and support your transaction.",
          "Carry out our duties as a licensed real estate brokerage, including our broker's review of each listing before it is published on the MLS.",
          "Deliver offers and showing requests to the seller and our broker, and keep you informed about them.",
          "Run AI features you choose to use (Section 5).",
          "Send transactional emails and, where permitted, marketing or prospecting emails (Section 7).",
          "Measure and improve the Service, including with analytics you accept (Section 6).",
          "Keep the Service safe: prevent fraud, abuse and automated attacks, and fix technical errors.",
          "Keep records of consents and transactions, resolve disputes, enforce our agreements and comply with legal obligations.",
        ],
        sub: [
          {
            heading: "3.1 Why We Are Allowed to Use It",
            body: [
              "We process personal information to provide the Service you request and perform our agreements with you, to meet legal and regulatory obligations that apply to a Florida real estate brokerage, for our legitimate business interests (such as security and improving the Service), and with your consent where we ask for it (for example, analytics cookies or calls and text messages). You can withdraw a consent at any time; withdrawal does not affect processing that took place before it. [VERIFICAR aplicabilidad: la política está pensada para usuarios de EE. UU.; confirmar si hace falta lenguaje de bases jurídicas y cuál.]",
            ],
          },
        ],
      },
      {
        heading: "4. How We Share Information",
        body: ["We share personal information only as described below. We do not sell personal information for money."],
        sub: [
          {
            id: "providers",
            heading: "4.1 Service Providers",
            body: [
              "We use the following providers to run the Service. They process personal information on our behalf and only for the purposes listed. Each one handles data under its own privacy policy, linked below.",
            ],
            bullets: PRIVACY_PROVIDERS.map((p) => providerBullet(p, "en")),
          },
          {
            heading: "4.2 The MLS and Real Estate Websites",
            body: [
              "When your listing is approved, our broker publishes it on the MLS. Listing information (address, price, property details, photos and description) then becomes public and is distributed by the MLS to real estate websites and other brokers. Your phone number is shown on those sites only if you choose that option. The buyer-agent compensation you choose is not published on the MLS.",
            ],
          },
          {
            heading: "4.3 Parties to Your Transaction",
            body: [
              "We share the information needed to negotiate and close your transaction with the other party and their agent, and, when you direct us, with closing agents, title companies, lenders or attorneys.",
            ],
          },
          {
            heading: "4.4 Legal Requirements and Safety",
            body: [
              "We may disclose information when required by law, subpoena or a request from a government authority (including the Florida Department of Business and Professional Regulation), or when needed to protect the rights, safety or property of Lixtara, our users or others.",
            ],
          },
          {
            heading: "4.5 Business Transfers",
            body: [
              "If Lixtara is involved in a merger, acquisition or sale of assets, personal information may be transferred as part of that transaction, subject to this Policy.",
            ],
          },
          {
            id: "no-sale",
            heading: "4.6 No Sale of Personal Information; Advertising",
            body: [
              "We do not sell personal information for money, and we do not use advertising cookies or targeted advertising on the Service. [VERIFICAR: Microsoft Clarity puede establecer la cookie MUID en dominios de Microsoft, que Microsoft describe como usada también para publicidad. Confirmar si esto es \"compartir\" para publicidad conductual bajo leyes estatales aplicables y si la frase anterior puede quedar así.]",
            ],
          },
        ],
      },
      {
        id: "ai",
        heading: "5. Artificial Intelligence Features",
        body: [
          "Some features use AI models from third-party providers. Information you submit to these features is sent to the provider to generate the result:",
        ],
        bullets: [
          "Loui assistant: your messages are sent to Anthropic. If you are signed in as a seller, Loui can also read your listings and the offers received on them (including the buyer's name and any notes in the offer) to answer your questions. Do not share in the chat information you do not want processed this way. [VERIFICAR: si conviene dejar de enviar el nombre y las notas del comprador al modelo.]",
          "Listing description and showing instructions: when you ask us to improve them, the text is sent to Anthropic.",
          "Photos: when you use virtual staging, the photo is sent to Luma AI; when you create a Living Listing video, the photo is sent to Google (Gemini API); some photo-analysis features send photos to Anthropic.",
          "We do not send MLS listing data to AI models.",
          "AI results can be wrong. Loui's answers are not legal, tax or financial advice, and staged or generated images are illustrations, labeled as such.",
        ],
      },
      {
        id: "cookies",
        heading: "6. Cookies and Session Recording",
        body: [
          "We use cookies that the Service needs to work (for example, to keep you signed in). Analytics tools load only if you accept analytics cookies in the cookie banner, and you can change your choice at any time through \"Cookie settings\" in the site footer. The full list is in our Cookie Policy.",
        ],
        sub: [
          {
            heading: "6.1 Usage Analytics and Session Recording",
            body: [
              "We use Microsoft Clarity, a service of Microsoft Corporation, to understand how the Service is used through heatmaps and session recordings. This helps us find where the site is hard to use and improve it.",
              "Clarity runs only if you accept analytics cookies in the cookie banner. You can withdraw your consent at any time through \"Cookie settings\" in the site footer; after that, Clarity is no longer loaded.",
            ],
            bullets: [
              "The text and data you type are hidden in the recordings. Photos, documents and signatures are hidden as well.",
              "Your account area (/account) is not recorded. Payment is not recorded either: it takes place on Stripe's pages, outside our site.",
              "Microsoft processes this data under its own privacy statement: https://privacy.microsoft.com/privacystatement",
            ],
          },
        ],
      },
      {
        id: "communications",
        heading: "7. Email, Calls and Text Messages",
        body: [],
        bullets: [
          "Transactional email: we send emails you need to use the Service (verification codes, receipts, status of your listing, offers and showing requests). You cannot opt out of these while you use the Service.",
          "Marketing and prospecting email: we may email property owners about our services, including owners who have not used the Service, using contact data described in Section 2.3. Every such email identifies Lixtara, includes our postal address and has an unsubscribe link; we honor unsubscribe requests. [VERIFICAR: requisitos de CAN-SPAM y de la ley de Florida para correos comerciales a propietarios.]",
          "Calls and text messages: we call or text you only with your consent or to respond to your own request. Agreeing to calls or texts is never a condition of buying our services. We do not currently send text messages. [VERIFICAR: si se activan SMS o llamadas automatizadas, revisar TCPA y Florida Telephone Solicitation Act antes.]",
        ],
      },
      {
        id: "retention",
        heading: "8. How Long We Keep Information",
        body: [
          "We keep personal information only as long as needed for the purposes in this Policy, including legal and recordkeeping obligations. The periods below are our current proposal:",
        ],
        bullets: [
          "Transaction and brokerage records (listing agreements, offers, payment records): at least 5 years after the transaction or the end of the listing. [VERIFICAR: plazo de conservación de registros del corredor en Florida (Ch. 475 / Reglas 61J2).]",
          "Consent records (Section 2.4): for as long as the account exists and at least 5 years after the consent. [VERIFICAR plazo.]",
          "Account information: while your account is active; when you ask us to delete it, we delete or de-identify what we are not required to keep.",
          "Unfinished listing drafts and abandoned sign-ups: [VERIFICAR plazo propuesto, p. ej. 24 meses sin actividad].",
          "Server logs and analytics data: according to the provider's settings, generally up to 13 months. [VERIFICAR.]",
        ],
      },
      {
        id: "security",
        heading: "9. Security and Data Breach Notice",
        body: [
          "We use reasonable administrative, technical and physical safeguards: encryption in transit, access controls limited by role, database rules that restrict each user to their own records, and providers with recognized security programs. No system is perfectly secure, and we cannot guarantee absolute security.",
          "If a breach of security affects your personal information, we will notify you and, when applicable, the appropriate authorities, in a manner consistent with the Florida Information Protection Act (section 501.171, Florida Statutes) and other applicable law. [VERIFICAR alcance: qué datos de Lixtara son \"personal information\" bajo §501.171 y plazos de notificación.]",
        ],
      },
      {
        id: "rights",
        heading: "10. Your Choices and Rights",
        body: [
          "You can review and update your account information at any time in your account area. You can also ask us to access, correct or delete your personal information, or to stop sending you marketing emails, by writing to {privacyEmail}. We will verify your identity before acting on a request and answer within a reasonable time.",
          "Depending on where you live, privacy laws may give you additional rights. Whether a particular law applies to Lixtara depends on thresholds set by that law. [VERIFICAR aplicabilidad por umbrales: CCPA/CPRA de California, Florida Digital Bill of Rights y otras leyes estatales; no afirmar cumplimiento hasta confirmar.]",
          "Some information cannot be deleted while we are required to keep it, for example records of a real estate transaction or of a payment.",
        ],
      },
      {
        heading: "11. Children",
        body: [
          "The Service is not directed to anyone under 18, and we do not knowingly collect personal information from children. If you believe a child has given us personal information, write to {privacyEmail} and we will delete it.",
        ],
      },
      {
        heading: "12. Where Information Is Processed",
        body: [
          "Lixtara is based in the United States and processes information in the United States. If you use the Service from another country, your information will be transferred to and processed in the United States.",
        ],
      },
      {
        heading: "13. Do Not Track",
        body: [
          "There is no common standard for responding to browser \"Do Not Track\" signals, so the Service does not respond to them. Analytics tools run only if you accept them in the cookie banner.",
        ],
      },
      {
        heading: "14. Links to Other Websites",
        body: [
          "The Service links to websites we do not control, such as MLS portals, Stripe and DocuSign. Their privacy practices are governed by their own policies.",
        ],
      },
      {
        heading: "15. Changes to This Policy",
        body: [
          "We may update this Policy. The version and the \"Last updated\" date at the top of this page change with each update, and we will give additional notice of material changes when appropriate.",
        ],
      },
      {
        heading: "16. Contact Us",
        body: [
          "Privacy questions and requests: {privacyEmail}",
          "General support: {supportEmail}",
          "Mail: {legalName}, {brokerageAddress}",
        ],
      },
    ],
  },
  es: {
    title: "Política de Privacidad",
    intro: [
      "Esta Política de Privacidad explica cómo {legalName} (\"Lixtara\", \"nosotros\") recopila, usa, comparte y protege la información personal cuando usted usa lixtara.com y nuestros servicios relacionados (el \"Servicio\"). Lixtara es una correduría inmobiliaria con licencia en Florida (FL #{brokerageLicense}), con domicilio en {brokerageAddress}.",
      "Léala junto con nuestros Términos del Servicio y nuestra Política de Cookies. Si no está de acuerdo con esta Política, le pedimos que no use el Servicio.",
    ],
    sections: [
      {
        heading: "1. Quiénes Somos y Qué Cubre Esta Política",
        body: [
          "Esta Política se aplica a la información personal que recopilamos a través del Servicio: el sitio público, el proceso de publicación para vendedores, el panel y el área de cuenta del vendedor, las herramientas para compradores (ofertas, casas guardadas y solicitudes de visita), el asistente de IA Loui, el staging virtual y las funciones de video del listado, y los correos que enviamos.",
          "No cubre sitios ni servicios operados por terceros, aunque los enlacemos, como las páginas donde Stripe procesa los pagos o donde DocuSign recoge las firmas. Esas empresas tratan su información según sus propias políticas.",
          "\"Usted\" es cualquier persona que use el Servicio: vendedores, compradores, visitantes y propietarios a quienes contactamos.",
        ],
      },
      {
        heading: "2. Información que Recopilamos",
        body: ["Recopilamos la información que usted nos da, la que se registra automáticamente cuando usa el Servicio y la que recibimos de otras fuentes."],
        sub: [
          {
            heading: "2.1 Información que Usted nos Da",
            body: [],
            bullets: [
              "Datos de la cuenta: nombre, correo electrónico, número de teléfono y contraseña. La contraseña la guarda nuestro proveedor de autenticación de forma protegida (cifrada mediante hash); nunca la vemos en texto legible.",
              "Datos del listado: la dirección y la unidad, las características de la propiedad, el precio, la descripción, las instrucciones de visita, la ocupación y los datos del inquilino, la compensación que usted ofrece al agente del comprador, y las fotos, videos y demás archivos que suba.",
              "Datos del acuerdo: la información que se incluye en su acuerdo de listado (por ejemplo, la descripción legal y el número de folio) y su firma electrónica, que recoge DocuSign.",
              "Datos de pago: el plan o servicio que compra y el estado del pago. Usted ingresa los datos de su tarjeta en las páginas de Stripe; Lixtara no recibe ni guarda números completos de tarjeta.",
              "Datos de compradores: cuando hace una oferta, pide una visita o guarda una casa, los datos de contacto, las condiciones de la oferta, la información de financiamiento y los mensajes que nos da. Las ofertas y las solicitudes de visita se comparten con el vendedor de esa casa y con nuestra broker.",
              "Comunicaciones: los mensajes que nos envía por formularios, correo o el asistente Loui, y sus preferencias sobre recibir correos, llamadas o mensajes de texto.",
            ],
          },
          {
            heading: "2.2 Información que se Registra Automáticamente",
            body: [],
            bullets: [
              "Datos del dispositivo y registros: dirección IP, tipo de navegador y de dispositivo, sistema operativo, páginas solicitadas y la fecha y hora de cada solicitud. Nuestro proveedor de alojamiento guarda estos datos en los registros del servidor.",
              "Datos de uso: las páginas y funciones que usa y lo que hace en el proceso de publicación (por ejemplo, qué paso completó), sin el texto que escribe.",
              "Cookies y tecnologías similares: según se describe en la Sección 6 y en nuestra Política de Cookies. Las herramientas de analítica solo funcionan si usted acepta las cookies de analítica.",
            ],
          },
          {
            heading: "2.3 Información de Otras Fuentes",
            body: [],
            bullets: [
              "Registros públicos del Tasador de Propiedades del Condado de Miami-Dade, que usamos para completar los datos de la propiedad.",
              "Valores estimados y ventas comparables de Rentcast, a partir de la dirección de la propiedad.",
              "Información de listados del servicio de listado múltiple (MLS) de MIAMI Association of REALTORS®, que recibimos a través de Bridge Interactive, incluido el nombre y los datos de contacto del agente y de la oficina que figuran en cada listado del MLS.",
              "Datos de prospección: para contactar a propietarios de inmuebles en el sur de Florida, usamos registros públicos de propiedades y datos de contacto (como correos electrónicos) obtenidos de proveedores de datos. [VERIFICAR: fuente de los datos de contacto, contrato con el proveedor y base para usarlos en correos de prospección.]",
            ],
          },
          {
            id: "consent-evidence",
            heading: "2.4 Registro de su Consentimiento",
            body: [
              "Cuando usted acepta nuestros Términos (incluidas las condiciones de reembolso antes de pagar), consiente el uso de registros y firmas electrónicas, o acepta recibir llamadas o mensajes de texto, guardamos constancia de esa aceptación: la fecha y la hora, la versión del documento, el idioma en que lo vio, una huella criptográfica (hash) del texto exacto que aceptó, su dirección IP y la identificación de su navegador (user agent).",
              "Usamos estas constancias solo para demostrar que el consentimiento se dio, para responder a disputas de pago (contracargos) y para cumplir nuestras obligaciones legales y de conservación de registros. [VERIFICAR: plazo de conservación de estos registros.]",
            ],
          },
        ],
      },
      {
        heading: "3. Para Qué Usamos la Información",
        body: ["Usamos la información personal para:"],
        bullets: [
          "Prestar el Servicio: crear y proteger su cuenta, preparar y publicar su listado, preparar su acuerdo de listado para la firma, procesar pagos y acompañar su transacción.",
          "Cumplir nuestras funciones de correduría inmobiliaria con licencia, incluida la revisión de cada listado por nuestra broker antes de publicarlo en el MLS.",
          "Hacer llegar las ofertas y las solicitudes de visita al vendedor y a nuestra broker, y mantenerle informado sobre ellas.",
          "Hacer funcionar las funciones de IA que usted decida usar (Sección 5).",
          "Enviar correos transaccionales y, cuando esté permitido, correos de marketing o de prospección (Sección 7).",
          "Medir y mejorar el Servicio, incluso con la analítica que usted acepte (Sección 6).",
          "Proteger el Servicio: prevenir fraudes, abusos y ataques automatizados, y corregir errores técnicos.",
          "Conservar constancia de consentimientos y transacciones, resolver disputas, hacer valer nuestros acuerdos y atender obligaciones legales.",
        ],
        sub: [
          {
            heading: "3.1 Por Qué Podemos Usarla",
            body: [
              "Tratamos la información personal para prestar el Servicio que usted pide y cumplir los acuerdos que tenemos con usted, para atender obligaciones legales y regulatorias de una correduría inmobiliaria en Florida, por intereses legítimos de nuestro negocio (como la seguridad y la mejora del Servicio) y con su consentimiento cuando se lo pedimos (por ejemplo, para las cookies de analítica o para llamadas y mensajes de texto). Puede retirar un consentimiento en cualquier momento; el retiro no afecta el tratamiento hecho antes. [VERIFICAR aplicabilidad: la política está pensada para usuarios de EE. UU.; confirmar si hace falta lenguaje de bases jurídicas y cuál.]",
            ],
          },
        ],
      },
      {
        heading: "4. Con Quién Compartimos la Información",
        body: ["Solo compartimos información personal como se describe a continuación. No vendemos información personal a cambio de dinero."],
        sub: [
          {
            id: "providers",
            heading: "4.1 Proveedores de Servicios",
            body: [
              "Usamos los siguientes proveedores para operar el Servicio. Tratan información personal por cuenta nuestra y solo para los fines indicados. Cada uno la trata según su propia política de privacidad, enlazada a continuación.",
            ],
            bullets: PRIVACY_PROVIDERS.map((p) => providerBullet(p, "es")),
          },
          {
            heading: "4.2 El MLS y los Portales Inmobiliarios",
            body: [
              "Cuando su listado se aprueba, nuestra broker lo publica en el MLS. A partir de ese momento la información del listado (dirección, precio, características, fotos y descripción) es pública y el MLS la distribuye a portales inmobiliarios y a otros corredores. Su número de teléfono aparece en esos portales solo si usted elige esa opción. La compensación que usted ofrece al agente del comprador no se publica en el MLS.",
            ],
          },
          {
            heading: "4.3 Las Partes de su Transacción",
            body: [
              "Compartimos con la otra parte y con su agente la información necesaria para negociar y cerrar su transacción y, cuando usted nos lo indica, con agentes de cierre, compañías de título, prestamistas o abogados.",
            ],
          },
          {
            heading: "4.4 Requisitos Legales y Seguridad",
            body: [
              "Podemos divulgar información cuando lo exija la ley, una citación o una autoridad (incluido el Departamento de Regulación Comercial y Profesional de Florida, DBPR), o cuando sea necesario para proteger los derechos, la seguridad o los bienes de Lixtara, de nuestros usuarios o de terceros.",
            ],
          },
          {
            heading: "4.5 Transferencias del Negocio",
            body: [
              "Si Lixtara participa en una fusión, adquisición o venta de activos, la información personal puede transferirse como parte de esa operación, sujeta a esta Política.",
            ],
          },
          {
            id: "no-sale",
            heading: "4.6 No Vendemos Información Personal; Publicidad",
            body: [
              "No vendemos información personal a cambio de dinero, y no usamos cookies de publicidad ni publicidad dirigida en el Servicio. [VERIFICAR: Microsoft Clarity puede establecer la cookie MUID en dominios de Microsoft, que Microsoft describe como usada también para publicidad. Confirmar si esto es \"compartir\" para publicidad conductual bajo leyes estatales aplicables y si la frase anterior puede quedar así.]",
            ],
          },
        ],
      },
      {
        id: "ai",
        heading: "5. Funciones de Inteligencia Artificial",
        body: [
          "Algunas funciones usan modelos de IA de proveedores externos. Lo que usted envía a esas funciones se manda al proveedor para generar el resultado:",
        ],
        bullets: [
          "Asistente Loui: sus mensajes se envían a Anthropic. Si usted inició sesión como vendedor, Loui también puede leer sus listados y las ofertas recibidas en ellos (incluido el nombre del comprador y las notas de la oferta) para responder sus preguntas. No comparta en el chat información que no quiera que se trate de esta forma. [VERIFICAR: si conviene dejar de enviar el nombre y las notas del comprador al modelo.]",
          "Descripción del listado e instrucciones de visita: cuando nos pide mejorarlas, el texto se envía a Anthropic.",
          "Fotos: cuando usa el staging virtual, la foto se envía a Luma AI; cuando crea un video Living Listing, la foto se envía a Google (Gemini API); algunas funciones de análisis de fotos las envían a Anthropic.",
          "No enviamos datos de listados del MLS a modelos de IA.",
          "La IA puede equivocarse. Las respuestas de Loui no son asesoría legal, fiscal ni financiera, y las imágenes con staging o generadas son ilustraciones, identificadas como tales.",
        ],
      },
      {
        id: "cookies",
        heading: "6. Cookies y Grabación de Sesiones",
        body: [
          "Usamos las cookies que el Servicio necesita para funcionar (por ejemplo, para mantener su sesión iniciada). Las herramientas de analítica solo se cargan si usted acepta las cookies de analítica en el aviso de cookies, y puede cambiar su elección en cualquier momento en \"Configurar cookies\", en el pie del sitio. La lista completa está en nuestra Política de Cookies.",
        ],
        sub: [
          {
            heading: "6.1 Análisis de Uso y Grabación de Sesiones",
            body: [
              "Usamos Microsoft Clarity, un servicio de Microsoft Corporation, para entender cómo se usa el Servicio mediante mapas de calor y grabaciones de sesión. Esto nos ayuda a encontrar dónde el sitio es difícil de usar y a mejorarlo.",
              "Clarity solo funciona si usted acepta las cookies de analítica en el aviso de cookies. Puede retirar su consentimiento en cualquier momento en \"Configurar cookies\", en el pie del sitio; a partir de ese momento, Clarity deja de cargarse.",
            ],
            bullets: [
              "El texto y los datos que usted escribe se ocultan en las grabaciones. Las fotos, los documentos y las firmas también se ocultan.",
              "No se graba su área de cuenta (/account). Tampoco se graba el pago: ocurre en las páginas de Stripe, fuera de nuestro sitio.",
              "Microsoft procesa estos datos según su propia declaración de privacidad: https://privacy.microsoft.com/privacystatement",
            ],
          },
        ],
      },
      {
        id: "communications",
        heading: "7. Correos, Llamadas y Mensajes de Texto",
        body: [],
        bullets: [
          "Correos transaccionales: le enviamos los correos que necesita para usar el Servicio (códigos de verificación, recibos, estado de su listado, ofertas y solicitudes de visita). Mientras use el Servicio no puede darse de baja de estos correos.",
          "Correos de marketing y de prospección: podemos escribir a propietarios de inmuebles sobre nuestros servicios, incluso a propietarios que no han usado el Servicio, con los datos de contacto descritos en la Sección 2.3. Cada uno de esos correos identifica a Lixtara, incluye nuestra dirección postal y un enlace para darse de baja, y respetamos cada baja. [VERIFICAR: requisitos de CAN-SPAM y de la ley de Florida para correos comerciales a propietarios.]",
          "Llamadas y mensajes de texto: solo le llamamos o escribimos por mensaje de texto con su consentimiento o para responder a una solicitud suya. Aceptar llamadas o mensajes nunca es condición para comprar nuestros servicios. Hoy no enviamos mensajes de texto. [VERIFICAR: si se activan SMS o llamadas automatizadas, revisar TCPA y Florida Telephone Solicitation Act antes.]",
        ],
      },
      {
        id: "retention",
        heading: "8. Cuánto Tiempo Conservamos la Información",
        body: [
          "Conservamos la información personal solo mientras sea necesaria para los fines de esta Política, incluidas las obligaciones legales y de conservación de registros. Los plazos siguientes son nuestra propuesta actual:",
        ],
        bullets: [
          "Registros de transacciones y de correduría (acuerdos de listado, ofertas, registros de pago): al menos 5 años después de la transacción o del fin del listado. [VERIFICAR: plazo de conservación de registros del corredor en Florida (Cap. 475 / Reglas 61J2).]",
          "Constancias de consentimiento (Sección 2.4): mientras exista la cuenta y al menos 5 años después del consentimiento. [VERIFICAR plazo.]",
          "Datos de la cuenta: mientras su cuenta esté activa; cuando nos pida eliminarla, borramos o desidentificamos lo que no estemos obligados a conservar.",
          "Borradores de listado sin terminar y registros abandonados: [VERIFICAR plazo propuesto, p. ej. 24 meses sin actividad].",
          "Registros del servidor y datos de analítica: según la configuración de cada proveedor, por lo general hasta 13 meses. [VERIFICAR.]",
        ],
      },
      {
        id: "security",
        heading: "9. Seguridad y Aviso de Incidentes",
        body: [
          "Aplicamos medidas administrativas, técnicas y físicas razonables: cifrado en tránsito, accesos limitados según la función de cada persona, reglas en la base de datos que limitan a cada usuario a sus propios registros, y proveedores con programas de seguridad reconocidos. Ningún sistema es completamente seguro y no podemos garantizar una seguridad absoluta.",
          "Si un incidente de seguridad afecta su información personal, le avisaremos a usted y, cuando corresponda, a las autoridades competentes, de manera coherente con la Florida Information Protection Act (sección 501.171 de los Estatutos de Florida) y demás leyes aplicables. [VERIFICAR alcance: qué datos de Lixtara son \"personal information\" bajo §501.171 y plazos de notificación.]",
        ],
      },
      {
        id: "rights",
        heading: "10. Sus Opciones y Derechos",
        body: [
          "Puede revisar y actualizar los datos de su cuenta en cualquier momento desde su área de cuenta. También puede pedirnos acceder a su información personal, corregirla o eliminarla, o dejar de recibir correos de marketing, escribiendo a {privacyEmail}. Verificaremos su identidad antes de atender la solicitud y le responderemos en un plazo razonable.",
          "Según dónde viva, las leyes de privacidad pueden darle derechos adicionales. Que una ley determinada se aplique a Lixtara depende de los umbrales que esa ley fija. [VERIFICAR aplicabilidad por umbrales: CCPA/CPRA de California, Florida Digital Bill of Rights y otras leyes estatales; no afirmar cumplimiento hasta confirmar.]",
          "Hay información que no podemos eliminar mientras estemos obligados a conservarla, por ejemplo los registros de una transacción inmobiliaria o de un pago.",
        ],
      },
      {
        heading: "11. Menores de Edad",
        body: [
          "El Servicio no está dirigido a menores de 18 años y no recopilamos a sabiendas información personal de menores. Si cree que un menor nos dio información personal, escriba a {privacyEmail} y la eliminaremos.",
        ],
      },
      {
        heading: "12. Dónde se Trata la Información",
        body: [
          "Lixtara tiene su sede en Estados Unidos y trata la información en Estados Unidos. Si usa el Servicio desde otro país, su información se transferirá a Estados Unidos y se tratará allí.",
        ],
      },
      {
        heading: "13. Señal \"Do Not Track\"",
        body: [
          "No existe un estándar común para responder a la señal \"Do Not Track\" de los navegadores, por lo que el Servicio no responde a ella. Las herramientas de analítica solo funcionan si usted las acepta en el aviso de cookies.",
        ],
      },
      {
        heading: "14. Enlaces a Otros Sitios",
        body: [
          "El Servicio tiene enlaces a sitios que no controlamos, como portales del MLS, Stripe y DocuSign. Sus prácticas de privacidad se rigen por sus propias políticas.",
        ],
      },
      {
        heading: "15. Cambios a Esta Política",
        body: [
          "Podemos actualizar esta Política. La versión y la fecha de \"Última actualización\", al inicio de esta página, cambian con cada actualización, y daremos un aviso adicional cuando los cambios sean importantes.",
        ],
      },
      {
        heading: "16. Contáctenos",
        body: [
          "Consultas y solicitudes de privacidad: {privacyEmail}",
          "Soporte general: {supportEmail}",
          "Correo postal: {legalName}, {brokerageAddress}",
        ],
      },
    ],
  },
};
