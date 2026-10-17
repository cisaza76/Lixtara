import type { LegalContent } from "./types";

// BORRADOR 2026-10 para revisión del abogado de Lixtara. Marcadores: src/lib/legal/config.ts.
// Avisos de correduría en Florida, vivienda justa, compensación al agente del comprador,
// fraude electrónico y RESPA. Ningún número de licencia, nombre ni dirección va escrito a
// mano: salen de src/config/brokerage.ts por los marcadores.
export const noticesDoc: LegalContent = {
  en: {
    title: "Brokerage, Fair Housing & Fraud Notices",
    intro: [
      "This page gathers the notices that apply to everyone who uses lixtara.com: who we are as a brokerage, how a brokerage relationship works in Florida, how commissions and buyer's-broker compensation work, our commitment to fair housing, how to protect yourself from wire fraud, and how we handle referrals to settlement service providers.",
      "These notices supplement our Terms of Service and Privacy Policy. They do not replace the written disclosures and agreements you receive during a transaction; if anything here differs from a signed agreement, the signed agreement controls.",
    ],
    sections: [
      {
        id: "brokerage",
        heading: "1. Who We Are",
        body: [
          "{legalName} is a real estate brokerage licensed by the Florida Department of Business and Professional Regulation as a Real Estate Corporation, license FL #{brokerageLicense}. Our qualifying broker is {brokerName}, Broker, license FL #{brokerLicense}. Our registered office is {brokerageAddress}.",
          "In our advertising, listings, emails and on this website we identify ourselves by our registered name, {legalName}. \"Lixtara\" is the brand under which {legalName} offers its services. [VERIFICAR: wording and placement required by Rule 61J2-10.025, F.A.C., for every advertisement, including social media and outbound email.]",
        ],
      },
      {
        id: "relationship",
        heading: "2. Brokerage Relationships in Florida",
        body: [
          "Florida law (Chapter 475, Florida Statutes) allows a real estate licensee to work with you in one of three ways:",
        ],
        bullets: [
          "Transaction broker: the broker gives limited representation to the buyer, the seller, or both. A transaction broker deals honestly and fairly, accounts for all funds, uses skill, care and diligence, discloses known facts that materially affect the value of residential property and are not readily observable, presents all offers and counteroffers in a timely manner, and maintains limited confidentiality. In Florida, a licensee is presumed to be a transaction broker unless another relationship is established in writing.",
          "Single agent: the broker represents only you and owes you, in addition to the duties above, loyalty, confidentiality, obedience and full disclosure.",
          "No brokerage relationship: the licensee does not represent you, but still must deal honestly and fairly, disclose known material facts, and account for funds.",
        ],
        sub: [
          {
            heading: "2.1 How we disclose the relationship",
            body: [
              "The type of brokerage relationship between you and {legalName}, and the duties that come with it, are stated in writing in the listing agreement you sign (and, for buyers, in the written agreement required before touring a home). Unless that agreement says otherwise, {legalName} works with sellers as a transaction broker.",
              "[VERIFICAR: which written disclosure under §475.278, F.S. applies to each flow (seller listing, buyer showing request, offer submitted through the site, paid consultations), and the exact form and moment of delivery — before or at the time of entering into a listing agreement or before showing a property.]",
            ],
          },
        ],
      },
      {
        id: "commissions",
        heading: "3. Commissions Are Negotiable",
        body: [
          "Commissions are negotiable and are not set by law.",
          "Our published plans are our offer to sellers: a flat fee paid when you list, plus a {legalName} commission at closing of {essentialsPct}% (Essentials), {proPct}% (Pro) or {conciergePct}% (Concierge), paid only if the property sells. You are free to negotiate different terms with us or to work with any other brokerage. [VERIFICAR: whether, and how, a seller can negotiate the plan fee or percentage in practice, so this sentence matches the actual process.]",
        ],
      },
      {
        id: "buyer-compensation",
        heading: "4. Compensation to a Buyer's Broker",
        body: [
          "Since the changes to industry practice that took effect in August 2024, compensation offered to a buyer's broker is not published on the multiple listing service (MLS). Whether to offer any compensation to a buyer's broker, and how much, is the seller's decision. It is always negotiable, and a seller may offer none.",
          "Buyers working with a broker sign their own written agreement with that broker, which states what the buyer's broker will be paid and by whom. {legalName} does not condition the listing, its marketing, showings or the presentation of offers on whether the seller offers compensation to a buyer's broker, or on its amount.",
          "Any compensation the seller decides to offer is recorded in the listing agreement and communicated outside the MLS, in the manner allowed by the MLS rules. [VERIFICAR: current MIAMI REALTORS® / SEFMLS rules on how offers of compensation may be communicated off-MLS, and consistency with the listing agreement form.]",
        ],
      },
      {
        id: "fair-housing",
        heading: "5. Equal Housing Opportunity",
        body: [
          "{legalName} is an Equal Housing Opportunity brokerage. We are committed to the letter and the spirit of the federal Fair Housing Act and the Florida Fair Housing Act (Chapter 760, Florida Statutes).",
          "We do not discriminate, and we do not accept listings, instructions, advertising or communications that discriminate, in the sale or rental of housing on the basis of race, color, national origin, religion, sex, disability (handicap), or familial status, or any other characteristic protected by federal, state or local law. [VERIFICAR: additional protected classes under local ordinances that apply to our listings, such as the Miami-Dade County Human Rights Ordinance (e.g., sexual orientation, gender identity, source of income, age, marital status) and municipal ordinances.]",
          "We may refuse or remove any listing, description, photo or message that expresses a preference, limitation or discrimination prohibited by these laws.",
        ],
        sub: [
          {
            heading: "5.1 How to report housing discrimination",
            body: [
              "If you believe you have experienced housing discrimination, you can contact us at {supportEmail}. You may also file a complaint with the U.S. Department of Housing and Urban Development (HUD), Office of Fair Housing and Equal Opportunity, at 1-800-669-9777 or hud.gov/fairhousing, or with the Florida Commission on Human Relations. [VERIFICAR: current telephone numbers and filing channels for HUD, the Florida Commission on Human Relations and the Miami-Dade Commission on Human Rights.]",
            ],
          },
        ],
      },
      {
        id: "wire-fraud",
        heading: "6. Wire Fraud Warning",
        body: [
          "Criminals target real estate transactions by sending fake emails or text messages that look like they come from a broker, title company, attorney or lender, asking you to wire money or announcing \"new\" payment instructions.",
          "{legalName} will never ask you to send money by wire transfer through email or text message, and will never change payment or wiring instructions by email or text message. We charge our plan fees only through the secure checkout on our website. [VERIFICAR: that {legalName} does not hold escrow deposits or any client funds; if it ever does, add the escrow procedure here.]",
        ],
        bullets: [
          "Before sending any money, call the recipient at a phone number you obtained independently, not one taken from the email or message that sent the instructions.",
          "Never act on wiring instructions that arrive or change at the last minute, especially if they ask for urgency or secrecy.",
          "If you suspect fraud, call your bank immediately to try to stop or recall the transfer, then report it to the FBI's Internet Crime Complaint Center (ic3.gov) and to us at {supportEmail}.",
        ],
      },
      {
        id: "respa",
        heading: "7. Referrals to Settlement Service Providers",
        body: [
          "You are free to choose your own title company, closing agent, lender, attorney, inspector and any other settlement service provider. Using a provider we mention is never a condition of working with {legalName}.",
          "If {legalName} ever refers you to a provider in which it or its owners have an ownership or financial interest, or from which it receives any thing of value for the referral, we will give you the Affiliated Business Arrangement disclosure required by the Real Estate Settlement Procedures Act (RESPA) before or at the time of the referral, and we will not receive any fee prohibited by that law. [VERIFICAR: whether any such relationship exists today — for example, the attorney consultations sold through the site, the \"Unlimited attorney consultations\" in the Concierge plan, or coordination with a title company — and, if so, prepare the disclosure.]",
        ],
      },
    ],
  },
  es: {
    title: "Avisos de Corretaje, Vivienda Justa y Fraude",
    intro: [
      "En esta página reunimos los avisos que aplican a todas las personas que usan lixtara.com: quiénes somos como correduría, cómo funcionan las relaciones de corretaje en Florida, cómo se manejan las comisiones y la compensación al corredor del comprador, nuestro compromiso con la vivienda justa, cómo protegerse del fraude por transferencia bancaria y cómo tratamos las referencias a proveedores de servicios de cierre.",
      "Estos avisos complementan nuestros Términos de Servicio y nuestra Política de Privacidad. No sustituyen las divulgaciones y los acuerdos escritos que usted recibe durante una transacción; si algo de lo que aquí se dice difiere de un acuerdo firmado, prevalece el acuerdo firmado.",
    ],
    sections: [
      {
        id: "brokerage",
        heading: "1. Quiénes Somos",
        body: [
          "{legalName} es una correduría inmobiliaria con licencia del Departamento de Regulación Comercial y Profesional de Florida como Real Estate Corporation, licencia FL #{brokerageLicense}. Nuestra corredora calificada es {brokerName}, Broker, licencia FL #{brokerLicense}. Nuestra oficina registrada está en {brokerageAddress}.",
          "En nuestra publicidad, nuestros listados, nuestros correos y este sitio web nos identificamos con nuestro nombre registrado, {legalName}. \"Lixtara\" es la marca con la que {legalName} ofrece sus servicios. [VERIFICAR: redacción y ubicación que exige la Regla 61J2-10.025, F.A.C., en cada anuncio, incluidas las redes sociales y los correos de prospección.]",
        ],
      },
      {
        id: "relationship",
        heading: "2. Relaciones de Corretaje en Florida",
        body: [
          "La ley de Florida (Capítulo 475 de los Estatutos de Florida) permite que un profesional inmobiliario con licencia trabaje con usted de una de estas tres formas:",
        ],
        bullets: [
          "Corredor de transacción (transaction broker): el corredor da una representación limitada al comprador, al vendedor o a ambos. Actúa con honestidad y equidad, rinde cuentas de todos los fondos, actúa con pericia, cuidado y diligencia, divulga los hechos conocidos que afectan de manera importante el valor de una propiedad residencial y que no son fácilmente observables, presenta oportunamente todas las ofertas y contraofertas y mantiene una confidencialidad limitada. En Florida se presume que el profesional es corredor de transacción, salvo que por escrito se establezca otra relación.",
          "Agente único (single agent): el corredor lo representa solo a usted y, además de los deberes anteriores, le debe lealtad, confidencialidad, obediencia y divulgación total.",
          "Sin relación de corretaje: el profesional no lo representa, pero igualmente debe actuar con honestidad y equidad, divulgar los hechos importantes que conozca y rendir cuentas de los fondos.",
        ],
        sub: [
          {
            heading: "2.1 Cómo le informamos la relación",
            body: [
              "El tipo de relación de corretaje entre usted y {legalName}, y los deberes que conlleva, constan por escrito en el contrato de listado que usted firma (y, en el caso de compradores, en el acuerdo escrito que se exige antes de visitar una vivienda). Salvo que ese acuerdo diga otra cosa, {legalName} trabaja con los vendedores como corredor de transacción.",
              "[VERIFICAR: qué divulgación escrita del §475.278 de los Estatutos de Florida corresponde a cada flujo (listado del vendedor, solicitud de visita del comprador, oferta enviada desde el sitio, consultas pagadas) y la forma y el momento exactos de entrega: antes o al momento de firmar el contrato de listado, o antes de mostrar una propiedad.]",
            ],
          },
        ],
      },
      {
        id: "commissions",
        heading: "3. Las Comisiones Son Negociables",
        body: [
          "Las comisiones son negociables y no las fija la ley.",
          "Nuestros planes publicados son nuestra oferta a los vendedores: una tarifa fija que se paga al publicar, más una comisión de {legalName} al cierre del {essentialsPct}% (Essentials), del {proPct}% (Pro) o del {conciergePct}% (Concierge), que solo se paga si la propiedad se vende. Usted es libre de negociar con nosotros condiciones distintas o de trabajar con cualquier otra correduría. [VERIFICAR: si un vendedor puede negociar en la práctica la tarifa o el porcentaje del plan, y cómo, para que esta frase coincida con el proceso real.]",
        ],
      },
      {
        id: "buyer-compensation",
        heading: "4. Compensación al Corredor del Comprador",
        body: [
          "Desde los cambios en la práctica del sector que entraron en vigor en agosto de 2024, la compensación ofrecida al corredor del comprador no se publica en el servicio de listados múltiples (MLS). Ofrecer o no una compensación al corredor del comprador, y por qué monto, es decisión del vendedor. Siempre es negociable, y el vendedor puede no ofrecer ninguna.",
          "Los compradores que trabajan con un corredor firman su propio acuerdo escrito con ese corredor, en el que consta cuánto se le pagará y quién lo pagará. {legalName} no condiciona el listado, su promoción, las visitas ni la presentación de ofertas a que el vendedor ofrezca una compensación al corredor del comprador, ni a su monto.",
          "La compensación que el vendedor decida ofrecer queda registrada en el contrato de listado y se comunica fuera del MLS, en la forma que permiten las reglas del MLS. [VERIFICAR: reglas vigentes de MIAMI REALTORS® / SEFMLS sobre cómo pueden comunicarse fuera del MLS las ofertas de compensación, y coherencia con el formulario del contrato de listado.]",
        ],
      },
      {
        id: "fair-housing",
        heading: "5. Igualdad de Oportunidades en la Vivienda",
        body: [
          "{legalName} es una correduría que ofrece igualdad de oportunidades en la vivienda (Equal Housing Opportunity). Nos comprometemos con la letra y el espíritu de la Ley federal de Vivienda Justa (Fair Housing Act) y de la Ley de Vivienda Justa de Florida (Capítulo 760 de los Estatutos de Florida).",
          "No discriminamos, ni aceptamos listados, instrucciones, anuncios o comunicaciones que discriminen, en la venta o el alquiler de viviendas por motivos de raza, color, origen nacional, religión, sexo, discapacidad o situación familiar, ni por ninguna otra característica protegida por la ley federal, estatal o local. [VERIFICAR: otras categorías protegidas por ordenanzas locales aplicables a nuestros listados, como la Ordenanza de Derechos Humanos del Condado de Miami-Dade (p. ej., orientación sexual, identidad de género, fuente de ingresos, edad, estado civil) y las ordenanzas municipales.]",
          "Podemos rechazar o retirar cualquier listado, descripción, foto o mensaje que exprese una preferencia, limitación o discriminación prohibida por estas leyes.",
        ],
        sub: [
          {
            heading: "5.1 Cómo denunciar discriminación en la vivienda",
            body: [
              "Si cree que ha sufrido discriminación en la vivienda, puede escribirnos a {supportEmail}. También puede presentar una queja ante la Oficina de Vivienda Justa e Igualdad de Oportunidades del Departamento de Vivienda y Desarrollo Urbano de los EE. UU. (HUD), en el 1-800-669-9777 o en hud.gov/fairhousing, o ante la Comisión de Relaciones Humanas de Florida. [VERIFICAR: teléfonos y vías de presentación vigentes de HUD, de la Comisión de Relaciones Humanas de Florida y de la Comisión de Derechos Humanos de Miami-Dade.]",
            ],
          },
        ],
      },
      {
        id: "wire-fraud",
        heading: "6. Aviso de Fraude por Transferencia Bancaria",
        body: [
          "Los delincuentes atacan las operaciones inmobiliarias con correos o mensajes de texto falsos que parecen venir de un corredor, una compañía de títulos, un abogado o un prestamista, y que piden transferir dinero o anuncian \"nuevas\" instrucciones de pago.",
          "{legalName} nunca le pedirá que envíe dinero por transferencia bancaria mediante un correo o un mensaje de texto, y nunca cambiará instrucciones de pago o de transferencia por correo ni por mensaje de texto. Cobramos las tarifas de nuestros planes únicamente a través del pago seguro de nuestro sitio web. [VERIFICAR: que {legalName} no recibe depósitos en garantía (escrow) ni otros fondos de clientes; si alguna vez lo hace, agregar aquí el procedimiento.]",
        ],
        bullets: [
          "Antes de enviar dinero, llame al destinatario a un número de teléfono que usted haya obtenido por su cuenta, nunca al que aparece en el correo o mensaje con las instrucciones.",
          "No siga nunca instrucciones de transferencia que llegan o cambian a último momento, sobre todo si le piden urgencia o reserva.",
          "Si sospecha un fraude, llame de inmediato a su banco para intentar detener o revertir la transferencia y luego denúncielo ante el Centro de Denuncias de Delitos en Internet del FBI (ic3.gov) y ante nosotros en {supportEmail}.",
        ],
      },
      {
        id: "respa",
        heading: "7. Referencias a Proveedores de Servicios de Cierre",
        body: [
          "Usted es libre de elegir su propia compañía de títulos, agente de cierre, prestamista, abogado, inspector y cualquier otro proveedor de servicios de cierre. Usar un proveedor que mencionemos nunca es una condición para trabajar con {legalName}.",
          "Si alguna vez {legalName} lo refiere a un proveedor en el que la empresa o sus dueños tienen una participación o un interés económico, o del que recibe algo de valor por la referencia, le entregaremos antes o al momento de la referencia la divulgación de Acuerdo Comercial Afiliado (Affiliated Business Arrangement) que exige la Ley de Procedimientos de Liquidación de Bienes Raíces (RESPA), y no recibiremos ningún pago prohibido por esa ley. [VERIFICAR: si hoy existe alguna relación de ese tipo — por ejemplo, las consultas con abogado que se venden en el sitio, las \"consultas ilimitadas con abogado\" del plan Concierge o la coordinación con una compañía de títulos — y, si existe, preparar la divulgación.]",
        ],
      },
    ],
  },
};
