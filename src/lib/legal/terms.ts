import type { LegalContent } from "./types";

// Términos de servicio. BORRADOR 2026-10 para revisión del abogado de Lixtara: los
// "[VERIFICAR: …]" se muestran a propósito y se resuelven en docs/legal/memo-revision-*.
// Marcadores ({legalName}, {essentialsFee}, …): src/lib/legal/config.ts. Ningún precio,
// porcentaje, licencia ni dirección va escrito a mano en este archivo.
// Anclas que usa el sitio: #fees, #refunds (casilla del paso 8), #term.

export const termsDoc: LegalContent = {
  en: {
    title: "Terms of Service",
    intro: [
      "These Terms of Service (the \"Terms\") govern your use of lixtara.com and the related applications and services (the \"Services\") operated by {legalName}, a Florida real estate brokerage corporation (license {brokerageLicense}; qualifying broker {brokerName}, license {brokerLicense}), located at {brokerageAddress} (\"Lixtara,\" \"we,\" \"us,\" or \"our\").",
      "By using the Services, creating an account, starting a listing, paying a fee, or signing an agreement through the Services, you agree to these Terms and to our Privacy Policy. If you do not agree, do not use the Services. Section 17 contains a dispute-resolution provision that affects your rights. [VERIFICAR: mecanismo de aceptación (casilla con enlace) en registro y en el paso 7, no solo texto]",
    ],
    sections: [
      {
        heading: "1. Who We Are and What We Do",
        body: [
          "Lixtara combines for-sale-by-owner tools with the services of a licensed Florida real estate brokerage. Through the Services, a seller builds a listing, chooses a plan, signs a listing agreement with {legalName}, pays the plan fee, and, once our broker approves it, has the property entered in the multiple listing service (MLS), from which it may be syndicated to third-party portals.",
          "The brokerage services for your property are provided under the listing agreement you sign (a Florida Realtors form, signed electronically). These Terms govern the use of the website and the platform. If these Terms and your signed listing agreement conflict on a brokerage matter, the listing agreement controls.",
          "Lixtara is not a law firm, lender, mortgage broker, title or escrow agent, appraiser, inspector, surveyor, accountant, or tax advisor. Nothing in the Services is legal, tax, financial, appraisal, or investment advice.",
        ],
      },
      {
        heading: "2. Eligibility and Accounts",
        body: [
          "You must be at least 18 years old and able to enter into a binding contract. The Services are designed for residential property located in Florida.",
          "You may start a listing before creating an account. Before you sign the listing agreement, you must create an account with accurate information. You are responsible for keeping your credentials confidential and for activity under your account. Tell us at {supportEmail} if you suspect unauthorized use.",
          "If you act for a company, trust, estate, or other entity, you confirm you are authorized to bind it.",
        ],
      },
      {
        id: "fees",
        heading: "3. Plans, Fees, and Commission",
        body: [
          "Each plan has a one-time flat fee, paid when you list, plus a Lixtara commission that is paid only at closing and only if your property sells:",
        ],
        table: {
          columns: ["Plan", "Flat fee", "Lixtara commission at closing", "Highlights"],
          rows: [
            ["Essentials", "{essentialsFee}", "{essentialsPct}% of the sale price, only if it sells", "MLS listing and syndication; you upload your own photos (minimum required by the listing flow); self-service dashboard; email support. Professional photography available as an add-on for {photoAddonPrice}."],
            ["Pro", "{proFee}", "{proPct}% of the sale price, only if it sells", "Everything in Essentials, plus professional photography included, a broker compliance and strategy call, and broker review of the description."],
            ["Concierge", "{conciergeFee}", "{conciergePct}% of the sale price, only if it sells", "Everything in Pro, plus broker-led negotiation assistance and transaction management through closing. [VERIFICAR: alcance exacto de \"dedicated broker, 7 days a week\" y de las consultas \"ilimitadas\" con Realtor y abogado que anuncia el sitio]"],
          ],
        },
        bullets: [
          "When the flat fee is charged: after you sign the listing agreement electronically and before our broker countersigns and approves the listing. Payment is processed by Stripe.",
          "When the commission is due: only at closing, only if the property sells, and as set out in your listing agreement. It is normally paid from the sale proceeds through the closing agent. [VERIFICAR: redacción del listing agreement sobre comisión por venta durante el plazo o en el período de protección]",
          "Add-ons, such as professional photography on Essentials ({photoAddonPrice}) or virtual staging beyond the {stagingFreeQuota} free actions per listing ({stagingOveragePrice} each), are optional and their price is shown before you pay.",
          "Consultations with a Realtor or an attorney, where offered, are sold separately at the rates shown on the Site. [VERIFICAR: quién presta la consulta legal, si Lixtara participa de los honorarios, y si hace falta un aviso de que Lixtara no es un bufete]",
          "Prices are in U.S. dollars. The plan fee and the commission percentage that apply to you are the ones in effect when you sign your listing agreement.",
        ],
      },
      {
        id: "refunds",
        heading: "4. Refunds",
        body: [
          "The plan fee is not refundable once your listing has been published on the MLS.",
          "We refund the full plan fee in these three cases:",
        ],
        bullets: [
          "Our broker does not approve your listing, or Lixtara cannot publish it on the MLS.",
          "You were charged twice, or charged because of a technical error.",
          "You cancel before your listing is published on the MLS.",
        ],
        sub: [
          {
            heading: "4.1 How to request a refund",
            body: [
              "Write to {supportEmail} from the email on your account and include the property address. We refund to the original payment method through Stripe. [VERIFICAR: plazo para procesar el reembolso (propuesta: 10 días hábiles desde la solicitud) y plazo para pedirlo en caso de cobro duplicado]",
              "The Lixtara commission is only owed if the property sells. Ending the listing itself, and any amounts owed when it ends, are governed by your listing agreement. [VERIFICAR: coherencia con la cláusula de terminación del ERS-21tn]",
              "Add-ons are refundable on the same terms as the plan fee unless the service has already been performed (for example, a completed photo session or a staging image already generated). [VERIFICAR: decisión del owner sobre reembolso de add-ons, consultas y staging]",
            ],
          },
        ],
      },
      {
        id: "term",
        heading: "5. Listing Term and Publication",
        body: [
          "Each listing has a term of {termMonths} months from the start date in your listing agreement, unless it ends earlier as that agreement allows.",
          "We aim to publish your listing on the MLS within {publicationBusinessDays} business days after our broker countersigns your listing agreement, provided the listing is complete and meets MLS rules. [VERIFICAR: plazo con el owner; el sitio hoy anuncia \"live within 48h\" para Pro y Concierge]",
          "Display on third-party portals (for example Zillow, Realtor.com, Redfin, or Trulia) depends on the MLS and on those portals. We do not control their timing or format.",
        ],
      },
      {
        heading: "6. No Guarantee of Sale or Price",
        body: [
          "We do not guarantee that your property will sell, that it will receive offers, or that it will sell at any price, on any terms, or within any time. Results depend on factors outside our control, such as market conditions, price, condition of the property, and buyer decisions. Any estimate, comparable sale, or price suggestion shown in the Services is informational and is not an appraisal.",
        ],
      },
      {
        heading: "7. Brokerage Relationship and Buyer-Agent Compensation",
        body: [
          "Your brokerage relationship with {legalName} (its type, scope, and duties) is created by the listing agreement and the brokerage relationship disclosure you receive under Chapter 475, Florida Statutes. These Terms do not create a brokerage relationship on their own. [VERIFICAR: forma y momento de entrega del aviso de relación (transaction broker / single agent)]",
          "Commissions are negotiable and are not set by law.",
          "Compensation to a buyer's agent, if any, is your decision, is negotiable, and is agreed in writing. It is not published on the MLS. If a buyer's agent requests compensation, it is handled through a written agreement as part of the offer and negotiation. [VERIFICAR: cómo se documenta la oferta de compensación (addendum, contraoferta) y el texto del paso 6, pendiente de la broker]",
          "On the Concierge plan the Site states that buyer-agent compensation is set at a fixed percentage. [VERIFICAR: pendiente de aprobación de la broker; no publicar como condición fija hasta entonces]",
        ],
      },
      {
        heading: "8. Seller Responsibilities",
        bullets: [
          "You give us true, complete, and current information about the property and correct it promptly when it changes.",
          "You are the owner of record or are authorized by every owner of record to list and sell the property, and you will tell us about co-owners, spouses with homestead rights, trusts, estates, or powers of attorney that affect the sale. [VERIFICAR: atestación de titularidad en el flujo y documentación exigida]",
          "You disclose known facts that materially affect the value of the property and are not readily observable, as Florida law requires of sellers of residential property. [VERIFICAR: redacción del deber de divulgación (Johnson v. Davis) y formularios de divulgación que se usan]",
          "You own, or have permission to use, every photo, video, and text you upload, and you have the consent of any person who appears in them.",
          "You set the list price and decide which offers to accept.",
          "You comply with fair housing and anti-discrimination laws. Listings may not state any preference, limitation, or discrimination based on a protected characteristic.",
          "You review any AI-generated description, translation, or virtual staging before it is published and remain responsible for its accuracy.",
        ],
        body: [],
      },
      {
        heading: "9. Your Content and Our License",
        body: [
          "You keep ownership of the photos, videos, and text you provide (\"Listing Content\"). You grant {legalName} a non-exclusive, royalty-free, worldwide license to host, copy, adapt (for example resize, crop, or reformat), display, distribute, and syndicate your Listing Content to provide the Services, including submitting it to the MLS and to the portals that receive MLS data, and to show it in our marketing of your listing. This license lasts while your listing is active and for as long as needed to meet legal and MLS record-keeping obligations. Copies already distributed by the MLS or portals are outside our control.",
          "If you believe content on the Site infringes your copyright, see our Copyright and DMCA Policy.",
        ],
      },
      {
        heading: "10. AI Features",
        body: [
          "Loui, our chat assistant, is an artificial-intelligence tool. It gives general information only, may be wrong or out of date, and is not legal, tax, financial, or appraisal advice. It is not a licensed person. For decisions about your sale, consult our broker or your own professional advisors.",
          "AI tools in the Services can draft or improve listing descriptions and create virtual staging or motion images from your photos. Virtually staged and AI-generated images are labeled as such and do not show the actual condition or contents of the property. Originals are kept and available on request.",
        ],
      },
      {
        heading: "11. Using the Site",
        body: [
          "You agree not to:",
        ],
        bullets: [
          "break the law or use the Services to deceive or defraud anyone;",
          "list a property you do not own or are not authorized to list, or that you do not intend to sell;",
          "post false, misleading, discriminatory, defamatory, or infringing content;",
          "copy, scrape, or collect data from the Services by automated means, or use MLS data shown on the Site for anything other than your personal, non-commercial interest in buying or selling real estate;",
          "interfere with the security or operation of the Services, try to access accounts or data that are not yours, or get around rate limits or security checks;",
          "use the Services to send spam or to harass anyone.",
        ],
      },
      {
        heading: "12. Third-Party Services",
        body: [
          "The Services use third-party providers, for example Stripe for payments, DocuSign for electronic signatures, and map, data, and AI providers. Their own terms and privacy policies apply to what they do. Our Privacy Policy lists the providers that process personal data. We are not responsible for third-party services or for the accuracy of data they supply, such as public records, valuations, or maps.",
        ],
      },
      {
        heading: "13. Electronic Communications and Signatures",
        body: [
          "You agree to receive notices, agreements, and other communications about your account and listing electronically, by email and in the Services, and that they satisfy any requirement that they be in writing.",
          "Before you sign the listing agreement in DocuSign, we show you a separate notice about electronic records and signatures. It explains how to get a paper copy, how to withdraw your consent, and the hardware and software you need. Your electronic signature is as binding as a handwritten one.",
          "Marketing messages by phone or text message are sent only with your separate consent, which is never a condition of buying our services. You can opt out of marketing email at any time with the link in each message.",
        ],
      },
      {
        heading: "14. Disclaimers",
        body: [
          "THE SERVICES ARE PROVIDED \"AS IS\" AND \"AS AVAILABLE.\" TO THE EXTENT THE LAW ALLOWS, LIXTARA DISCLAIMS ALL IMPLIED WARRANTIES, INCLUDING MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT. WE DO NOT WARRANT THAT THE SERVICES WILL BE UNINTERRUPTED OR ERROR-FREE, OR THAT DATA FROM THIRD PARTIES, ESTIMATES, OR AI OUTPUT WILL BE ACCURATE.",
          "These disclaimers do not limit the duties our brokerage owes you under Florida law and your listing agreement.",
        ],
      },
      {
        heading: "15. Limitation of Liability",
        body: [
          "TO THE EXTENT THE LAW ALLOWS, LIXTARA IS NOT LIABLE FOR INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR FOR LOST PROFITS OR DATA, ARISING FROM THE USE OF THE WEBSITE AND PLATFORM. OUR TOTAL LIABILITY FOR CLAIMS ABOUT THE WEBSITE AND PLATFORM WILL NOT EXCEED THE GREATER OF THE FEES YOU PAID US IN THE 12 MONTHS BEFORE THE CLAIM OR ONE HUNDRED U.S. DOLLARS.",
          "This section does not limit liability that cannot be limited by law, including for fraud, gross negligence, or intentional misconduct, and it does not change the duties our brokerage owes you under Chapter 475, Florida Statutes. [VERIFICAR: exigibilidad del tope frente a consumidores en Florida y frente a deberes de licenciatario]",
        ],
      },
      {
        heading: "16. Indemnification",
        body: [
          "You agree to indemnify Lixtara against third-party claims, and the related losses and reasonable attorneys' fees, that arise from information or content you provided that was false or infringing, from your breach of these Terms, or from your violation of law or of another person's rights. [VERIFICAR: alcance razonable para un contrato de consumo]",
        ],
      },
      {
        heading: "17. Disputes",
        body: [
          "Florida law governs these Terms, without regard to conflict-of-law rules, together with applicable federal law.",
          "Before filing a claim, please write to {supportEmail} and give us 30 days to try to resolve it.",
          "Unless the arbitration option below applies, any claim must be brought in the state or federal courts located in Miami-Dade County, Florida. Either party may bring an individual claim in small claims court if it qualifies.",
          "Arbitration and class-action waiver (option under review). [VERIFICAR arbitraje y renuncia a acciones colectivas: proveedor (AAA/JAMS), reglas de consumo, quién paga las tasas, opt-out de 30 días y si conviene incluirlo en un servicio de corretaje regulado] If adopted: disputes would be resolved by binding individual arbitration in Miami-Dade County under consumer rules, you could opt out within 30 days of accepting these Terms, and claims could only be brought individually, not as part of a class or representative action.",
          "Disputes about the listing agreement itself are resolved as that agreement provides.",
        ],
      },
      {
        heading: "18. Ending Your Use",
        body: [
          "You can stop using the Site at any time and close your account by writing to {supportEmail}. Closing the account does not end a signed listing agreement, which ends as it provides.",
          "We may suspend or close accounts that break these Terms or the law, or to protect the Services or other users. Provisions that by their nature survive, such as fees already owed, licenses, disclaimers, limitation of liability, and disputes, survive.",
        ],
      },
      {
        heading: "19. Changes to These Terms",
        body: [
          "We may update these Terms. The version and the \"last updated\" date at the top show the current version. We will tell you about material changes by email or in the Services before they take effect. Changes do not alter an agreement you have already signed or a fee you have already paid.",
        ],
      },
      {
        heading: "20. Language",
        body: [
          "These Terms are available in English and Spanish. If the versions differ, the English version governs.",
        ],
      },
      {
        heading: "21. General",
        body: [
          "If a provision is unenforceable, the rest remains in effect. Our failure to enforce a provision is not a waiver. You may not assign these Terms without our consent. These Terms, the Privacy Policy, and the agreements you sign through the Services are the entire agreement about the Services.",
        ],
      },
      {
        heading: "22. Contact",
        body: [
          "{legalName} · {brokerageAddress}",
          "Support and refunds: {supportEmail}. Privacy: {privacyEmail}.",
          "Florida real estate brokerage license {brokerageLicense}. Qualifying broker: {brokerName}, license {brokerLicense}.",
        ],
      },
    ],
  },
  es: {
    title: "Términos de Servicio",
    intro: [
      "Estos Términos de Servicio (los \"Términos\") rigen el uso de lixtara.com y de las aplicaciones y servicios relacionados (los \"Servicios\") que opera {legalName}, corporación de corretaje inmobiliario de Florida (licencia {brokerageLicense}; broker calificado {brokerName}, licencia {brokerLicense}), con domicilio en {brokerageAddress} (\"Lixtara\" o \"nosotros\").",
      "Al usar los Servicios, crear una cuenta, iniciar un listado, pagar una tarifa o firmar un acuerdo a través de los Servicios, usted acepta estos Términos y nuestra Política de Privacidad. Si no está de acuerdo, no use los Servicios. La Sección 17 contiene una cláusula de solución de controversias que afecta sus derechos. [VERIFICAR: mecanismo de aceptación (casilla con enlace) en registro y en el paso 7, no solo texto]",
    ],
    sections: [
      {
        heading: "1. Quiénes Somos y Qué Hacemos",
        body: [
          "Lixtara combina herramientas para vender sin agente (FSBO) con los servicios de una correduría inmobiliaria con licencia en Florida. En los Servicios, el vendedor arma su listado, elige un plan, firma un contrato de listado con {legalName}, paga la tarifa del plan y, una vez que nuestra broker lo aprueba, su propiedad se ingresa en el servicio de listado múltiple (MLS), desde donde puede difundirse a portales de terceros.",
          "Los servicios de corretaje sobre su propiedad se prestan según el contrato de listado que usted firma (un formulario de Florida Realtors, firmado electrónicamente). Estos Términos rigen el uso del sitio web y de la plataforma. Si estos Términos contradicen su contrato de listado en un asunto de corretaje, prevalece el contrato de listado.",
          "Lixtara no es un bufete de abogados, prestamista, corredor hipotecario, agente de título o de depósito en garantía, tasador, inspector, agrimensor, contador ni asesor fiscal. Nada en los Servicios constituye asesoría legal, fiscal, financiera, de tasación ni de inversión.",
        ],
      },
      {
        heading: "2. Requisitos y Cuentas",
        body: [
          "Debe tener al menos 18 años y capacidad para obligarse por contrato. Los Servicios están pensados para inmuebles residenciales ubicados en Florida.",
          "Puede comenzar un listado sin crear una cuenta. Antes de firmar el contrato de listado, debe crear una cuenta con información veraz. Usted es responsable de mantener la confidencialidad de sus credenciales y de lo que se haga con su cuenta. Avísenos a {supportEmail} si sospecha un uso no autorizado.",
          "Si actúa en nombre de una sociedad, fideicomiso, sucesión u otra entidad, usted declara que tiene facultades para obligarla.",
        ],
      },
      {
        id: "fees",
        heading: "3. Planes, Tarifas y Comisión",
        body: [
          "Cada plan tiene una tarifa fija única, que se paga al listar, más una comisión de Lixtara que se paga solo al cierre y solo si la propiedad se vende:",
        ],
        table: {
          columns: ["Plan", "Tarifa fija", "Comisión de Lixtara al cierre", "Qué incluye"],
          rows: [
            ["Essentials", "{essentialsFee}", "{essentialsPct}% del precio de venta, solo si se vende", "Listado en el MLS y difusión; usted sube sus propias fotos (con el mínimo que exige el flujo de listado); panel de autoservicio; soporte por correo. Fotografía profesional disponible como extra por {photoAddonPrice}."],
            ["Pro", "{proFee}", "{proPct}% del precio de venta, solo si se vende", "Todo lo de Essentials, más fotografía profesional incluida, una llamada de cumplimiento y estrategia con la broker y revisión de la descripción por la broker."],
            ["Concierge", "{conciergeFee}", "{conciergePct}% del precio de venta, solo si se vende", "Todo lo de Pro, más apoyo de la broker en la negociación y gestión de la transacción hasta el cierre. [VERIFICAR: alcance exacto de \"broker dedicada 7 días a la semana\" y de las consultas \"ilimitadas\" con Realtor y abogado que anuncia el sitio]"],
          ],
        },
        bullets: [
          "Cuándo se cobra la tarifa fija: después de que usted firma electrónicamente el contrato de listado y antes de que nuestra broker lo contrafirme y apruebe el listado. El pago lo procesa Stripe.",
          "Cuándo se paga la comisión: solo al cierre, solo si la propiedad se vende y según lo que establece su contrato de listado. Normalmente se paga con el producto de la venta, a través del agente de cierre. [VERIFICAR: redacción del contrato de listado sobre la comisión por venta durante el plazo o en el período de protección]",
          "Los extras, como la fotografía profesional en Essentials ({photoAddonPrice}) o el staging virtual más allá de las {stagingFreeQuota} acciones gratis por listado ({stagingOveragePrice} cada una), son opcionales y su precio se muestra antes de pagar.",
          "Las consultas con un Realtor o con un abogado, cuando se ofrecen, se venden por separado a las tarifas que indica el sitio. [VERIFICAR: quién presta la consulta legal, si Lixtara participa de los honorarios y si hace falta aclarar que Lixtara no es un bufete]",
          "Los precios están en dólares estadounidenses. La tarifa y el porcentaje de comisión que le aplican son los vigentes al firmar su contrato de listado.",
        ],
      },
      {
        id: "refunds",
        heading: "4. Reembolsos",
        body: [
          "La tarifa del plan no es reembolsable una vez que su listado se publica en el MLS.",
          "Reembolsamos la tarifa completa en estos tres casos:",
        ],
        bullets: [
          "Nuestra broker no aprueba su listado, o Lixtara no puede publicarlo en el MLS.",
          "Se le cobró dos veces, o se le cobró por un error técnico.",
          "Usted cancela antes de que su listado se publique en el MLS.",
        ],
        sub: [
          {
            heading: "4.1 Cómo pedir un reembolso",
            body: [
              "Escriba a {supportEmail} desde el correo de su cuenta e indique la dirección de la propiedad. Reembolsamos al mismo medio de pago, a través de Stripe. [VERIFICAR: plazo para procesar el reembolso (propuesta: 10 días hábiles desde la solicitud) y plazo para pedirlo en caso de cobro duplicado]",
              "La comisión de Lixtara solo se debe si la propiedad se vende. La terminación del listado, y lo que se deba al terminar, se rigen por su contrato de listado. [VERIFICAR: coherencia con la cláusula de terminación del ERS-21tn]",
              "Los extras se reembolsan en las mismas condiciones que la tarifa del plan, salvo que el servicio ya se haya prestado (por ejemplo, una sesión de fotos realizada o una imagen de staging ya generada). [VERIFICAR: decisión del owner sobre el reembolso de extras, consultas y staging]",
            ],
          },
        ],
      },
      {
        id: "term",
        heading: "5. Plazo del Listado y Publicación",
        body: [
          "Cada listado tiene un plazo de {termMonths} meses desde la fecha de inicio que indica su contrato de listado, salvo que termine antes según ese contrato.",
          "Procuramos publicar su listado en el MLS dentro de los {publicationBusinessDays} días hábiles siguientes a la contrafirma de su contrato por nuestra broker, siempre que el listado esté completo y cumpla las reglas del MLS. [VERIFICAR: plazo con el owner; hoy el sitio anuncia \"en vivo en 48 h\" para Pro y Concierge]",
          "La publicación en portales de terceros (por ejemplo Zillow, Realtor.com, Redfin o Trulia) depende del MLS y de esos portales. No controlamos sus tiempos ni su formato.",
        ],
      },
      {
        heading: "6. Sin Garantía de Venta ni de Precio",
        body: [
          "No garantizamos que su propiedad se venda, que reciba ofertas ni que se venda a un precio, en unas condiciones o en un plazo determinados. El resultado depende de factores que no controlamos, como el mercado, el precio, el estado de la propiedad y las decisiones de los compradores. Las estimaciones, ventas comparables o sugerencias de precio que mostramos son informativas y no son una tasación.",
        ],
      },
      {
        heading: "7. Relación de Corretaje y Compensación al Agente del Comprador",
        body: [
          "Su relación de corretaje con {legalName} (su tipo, alcance y deberes) nace del contrato de listado y del aviso de relación de corretaje que usted recibe conforme al Capítulo 475 de los Estatutos de Florida. Estos Términos, por sí solos, no crean una relación de corretaje. [VERIFICAR: forma y momento de entrega del aviso de relación (transaction broker / single agent)]",
          "Las comisiones son negociables y no las fija la ley.",
          "La compensación al agente del comprador, si la hay, la decide usted, es negociable y se acuerda por escrito. No se publica en el MLS. Si un agente del comprador la solicita, se trata mediante un acuerdo escrito como parte de la oferta y la negociación. [VERIFICAR: cómo se documenta el ofrecimiento de compensación (addendum, contraoferta) y el texto del paso 6, pendiente de la broker]",
          "En el plan Concierge, el sitio indica que la compensación al agente del comprador es un porcentaje fijo. [VERIFICAR: pendiente de aprobación de la broker; no presentarlo como condición fija hasta entonces]",
        ],
      },
      {
        heading: "8. Obligaciones del Vendedor",
        bullets: [
          "Nos da información veraz, completa y actualizada sobre la propiedad, y la corrige en cuanto cambie.",
          "Es el titular registral o cuenta con la autorización de todos los titulares para listar y vender la propiedad, y nos informará de copropietarios, cónyuges con derechos de homestead, fideicomisos, sucesiones o poderes que afecten la venta. [VERIFICAR: declaración de titularidad en el flujo y documentos que se exigen]",
          "Revela los hechos que conoce, que afectan de forma importante el valor de la propiedad y que no son fácilmente observables, como la ley de Florida exige al vendedor de una vivienda. [VERIFICAR: redacción del deber de revelación (Johnson v. Davis) y formularios de divulgación que se usan]",
          "Es dueño de las fotos, videos y textos que sube, o tiene permiso para usarlos, y cuenta con el consentimiento de las personas que aparecen en ellos.",
          "Fija el precio de lista y decide qué ofertas acepta.",
          "Cumple las leyes de vivienda justa y contra la discriminación. Un listado no puede expresar preferencias, limitaciones ni discriminación por una característica protegida.",
          "Revisa toda descripción, traducción o staging virtual generado con IA antes de que se publique, y sigue siendo responsable de su exactitud.",
        ],
        body: [],
      },
      {
        heading: "9. Su Contenido y Nuestra Licencia",
        body: [
          "Usted conserva la propiedad de las fotos, videos y textos que aporta (\"Contenido del Listado\"). Usted otorga a {legalName} una licencia no exclusiva, gratuita y mundial para alojar, copiar, adaptar (por ejemplo, cambiar el tamaño, recortar o dar formato), mostrar, distribuir y difundir su Contenido del Listado para prestar los Servicios, incluido enviarlo al MLS y a los portales que reciben datos del MLS, y para mostrarlo en la promoción de su listado. La licencia dura mientras su listado esté activo y el tiempo necesario para cumplir obligaciones legales y de conservación del MLS. Las copias que el MLS o los portales ya hayan distribuido quedan fuera de nuestro control.",
          "Si cree que algún contenido del sitio infringe sus derechos de autor, consulte nuestra Política de Derechos de Autor y DMCA.",
        ],
      },
      {
        heading: "10. Funciones de Inteligencia Artificial",
        body: [
          "Loui, nuestro asistente de chat, es una herramienta de inteligencia artificial. Da información general, puede equivocarse o estar desactualizado y no es asesoría legal, fiscal, financiera ni de tasación. No es una persona con licencia. Para las decisiones sobre su venta, consulte a nuestra broker o a sus propios asesores.",
          "Las herramientas de IA de los Servicios pueden redactar o mejorar descripciones y crear staging virtual o imágenes en movimiento a partir de sus fotos. Las imágenes con staging virtual o generadas con IA se identifican como tales y no muestran el estado real ni el contenido de la propiedad. Los originales se conservan y están disponibles a solicitud.",
        ],
      },
      {
        heading: "11. Uso del Sitio",
        body: [
          "Usted se compromete a no:",
        ],
        bullets: [
          "infringir la ley ni usar los Servicios para engañar o defraudar a nadie;",
          "listar una propiedad de la que no es dueño, que no está autorizado a listar o que no tiene intención de vender;",
          "publicar contenido falso, engañoso, discriminatorio, difamatorio o que infrinja derechos de terceros;",
          "copiar o extraer datos de los Servicios por medios automatizados, ni usar los datos del MLS que muestra el sitio para algo distinto de su interés personal y no comercial en comprar o vender un inmueble;",
          "afectar la seguridad o el funcionamiento de los Servicios, intentar acceder a cuentas o datos ajenos, ni eludir límites de uso o controles de seguridad;",
          "usar los Servicios para enviar spam ni para acosar a nadie.",
        ],
      },
      {
        heading: "12. Servicios de Terceros",
        body: [
          "Los Servicios usan proveedores externos, por ejemplo Stripe para los pagos, DocuSign para las firmas electrónicas y proveedores de mapas, datos e inteligencia artificial. Sus propios términos y políticas de privacidad rigen lo que ellos hacen. Nuestra Política de Privacidad enumera los proveedores que tratan datos personales. No respondemos por los servicios de terceros ni por la exactitud de los datos que aportan, como registros públicos, valuaciones o mapas.",
        ],
      },
      {
        heading: "13. Comunicaciones y Firmas Electrónicas",
        body: [
          "Usted acepta recibir por medios electrónicos, por correo y dentro de los Servicios, los avisos, contratos y demás comunicaciones sobre su cuenta y su listado, y que estos cumplen cualquier requisito de constar por escrito.",
          "Antes de firmar el contrato de listado en DocuSign, le mostramos un aviso aparte sobre registros y firmas electrónicas. Allí se explica cómo obtener una copia en papel, cómo retirar su consentimiento y qué equipo y programas necesita. Su firma electrónica obliga igual que una firma manuscrita.",
          "Los mensajes de marketing por teléfono o mensaje de texto se envían solo con su consentimiento aparte, que nunca es condición para comprar nuestros servicios. Puede darse de baja del correo de marketing en cualquier momento con el enlace que trae cada mensaje.",
        ],
      },
      {
        heading: "14. Exclusión de Garantías",
        body: [
          "LOS SERVICIOS SE OFRECEN \"TAL COMO ESTÁN\" Y \"SEGÚN DISPONIBILIDAD\". EN LA MEDIDA EN QUE LA LEY LO PERMITA, LIXTARA EXCLUYE TODA GARANTÍA IMPLÍCITA, INCLUIDAS LAS DE COMERCIABILIDAD, IDONEIDAD PARA UN FIN DETERMINADO Y NO INFRACCIÓN. NO GARANTIZAMOS QUE LOS SERVICIOS FUNCIONEN SIN INTERRUPCIONES NI ERRORES, NI QUE LOS DATOS DE TERCEROS, LAS ESTIMACIONES O LOS RESULTADOS DE LA IA SEAN EXACTOS.",
          "Esta exclusión no limita los deberes que nuestra correduría tiene con usted según la ley de Florida y su contrato de listado.",
        ],
      },
      {
        heading: "15. Limitación de Responsabilidad",
        body: [
          "EN LA MEDIDA EN QUE LA LEY LO PERMITA, LIXTARA NO RESPONDE POR DAÑOS INDIRECTOS, INCIDENTALES, ESPECIALES, CONSECUENTES O PUNITIVOS, NI POR LUCRO CESANTE O PÉRDIDA DE DATOS, DERIVADOS DEL USO DEL SITIO WEB Y DE LA PLATAFORMA. NUESTRA RESPONSABILIDAD TOTAL POR RECLAMOS SOBRE EL SITIO WEB Y LA PLATAFORMA NO SUPERARÁ LO QUE SEA MAYOR ENTRE LAS TARIFAS QUE NOS PAGÓ EN LOS 12 MESES ANTERIORES AL RECLAMO O CIEN DÓLARES ESTADOUNIDENSES.",
          "Esta sección no limita la responsabilidad que la ley no permite limitar, incluida la derivada de fraude, negligencia grave o dolo, ni modifica los deberes de nuestra correduría según el Capítulo 475 de los Estatutos de Florida. [VERIFICAR: exigibilidad del tope frente a consumidores en Florida y frente a los deberes del licenciatario]",
        ],
      },
      {
        heading: "16. Indemnización",
        body: [
          "Usted se obliga a mantener indemne a Lixtara frente a reclamos de terceros, y las pérdidas y honorarios razonables de abogados que generen, cuando deriven de información o contenido falso o infractor que usted aportó, de su incumplimiento de estos Términos o de su violación de la ley o de derechos ajenos. [VERIFICAR: alcance razonable para un contrato de consumo]",
        ],
      },
      {
        heading: "17. Controversias",
        body: [
          "Estos Términos se rigen por la ley de Florida, sin considerar sus normas de conflicto de leyes, y por la ley federal aplicable.",
          "Antes de presentar un reclamo, escríbanos a {supportEmail} y denos 30 días para intentar resolverlo.",
          "Salvo que aplique la opción de arbitraje que sigue, todo reclamo debe presentarse ante los tribunales estatales o federales del condado de Miami-Dade, Florida. Cualquiera de las partes puede presentar un reclamo individual ante el tribunal de menor cuantía si califica.",
          "Arbitraje y renuncia a acciones colectivas (opción en revisión). [VERIFICAR arbitraje y renuncia a acciones colectivas: proveedor (AAA/JAMS), reglas de consumo, quién paga las tasas, opt-out de 30 días y si conviene incluirlo en un servicio de corretaje regulado] Si se adopta: las controversias se resolverían por arbitraje individual y vinculante en el condado de Miami-Dade bajo reglas de consumo, usted podría excluirse dentro de los 30 días siguientes a aceptar estos Términos, y los reclamos solo podrían presentarse de forma individual, no como parte de una acción colectiva o representativa.",
          "Las controversias sobre el propio contrato de listado se resuelven como ese contrato lo establece.",
        ],
      },
      {
        heading: "18. Fin del Uso",
        body: [
          "Puede dejar de usar el sitio cuando quiera y cerrar su cuenta escribiendo a {supportEmail}. Cerrar la cuenta no termina un contrato de listado firmado, que termina según lo que él mismo establece.",
          "Podemos suspender o cerrar cuentas que incumplan estos Términos o la ley, o para proteger los Servicios o a otros usuarios. Las disposiciones que por su naturaleza deben subsistir, como las tarifas ya adeudadas, las licencias, la exclusión de garantías, la limitación de responsabilidad y las controversias, subsisten.",
        ],
      },
      {
        heading: "19. Cambios a Estos Términos",
        body: [
          "Podemos actualizar estos Términos. La versión y la fecha de \"última actualización\" que aparecen arriba indican la versión vigente. Le avisaremos de los cambios importantes por correo o dentro de los Servicios antes de que entren en vigor. Los cambios no modifican un contrato que usted ya firmó ni una tarifa que ya pagó.",
        ],
      },
      {
        heading: "20. Idioma",
        body: [
          "Estos Términos están disponibles en inglés y en español. Si las versiones difieren, prevalece la versión en inglés.",
        ],
      },
      {
        heading: "21. Disposiciones Generales",
        body: [
          "Si una disposición no es exigible, el resto sigue vigente. No exigir una disposición no implica renunciar a ella. Usted no puede ceder estos Términos sin nuestro consentimiento. Estos Términos, la Política de Privacidad y los contratos que firme a través de los Servicios constituyen el acuerdo completo sobre los Servicios.",
        ],
      },
      {
        heading: "22. Contacto",
        body: [
          "{legalName} · {brokerageAddress}",
          "Soporte y reembolsos: {supportEmail}. Privacidad: {privacyEmail}.",
          "Licencia de correduría inmobiliaria de Florida {brokerageLicense}. Broker calificada: {brokerName}, licencia {brokerLicense}.",
        ],
      },
    ],
  },
};
