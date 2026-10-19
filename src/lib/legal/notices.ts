import type { LegalContent } from "./types";
import { buyerAgentComp } from "@/config/legal-terms";

// Avisos de corretaje, vivienda justa y fraude v2 (2026-10-18), publicados por decisión del
// owner sin revisión del abogado todavía: docs/legal/2026-10-18-textos-v2-memo.md.
// Marcadores: src/lib/legal/config.ts. Ningún número de licencia, nombre ni dirección va
// escrito a mano (brokerage.ts); la compensación al agente del comprador sale de
// legal-terms.ts (la misma que los Términos §4.1).
export const noticesDoc: LegalContent = {
  en: {
    title: "Brokerage, Fair Housing & Fraud Notices",
    intro: [
      "This page gathers the notices that apply to everyone who uses lixtara.com: who we are as a brokerage, how a brokerage relationship works in Florida, how commissions and buyer's agent compensation work, our commitment to fair housing, how to protect yourself from wire fraud, and how we handle referrals to settlement service providers.",
      "These notices supplement our Terms of Service and Privacy Policy. They do not replace the written disclosures and agreements you receive during a transaction; if anything here differs from a signed agreement, the signed agreement controls.",
    ],
    sections: [
      {
        id: "brokerage",
        heading: "1. Who We Are",
        body: [
          "{legalName} is a real estate brokerage licensed by the Florida Department of Business and Professional Regulation as a Real Estate Corporation, license FL #{brokerageLicense}. Our qualifying broker is {brokerName}, Broker, license FL #{brokerLicense}. Our registered office is {brokerageAddress}.",
          "\"Lixtara\" is the brand under which {legalName} offers its services.",
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
              "The type of brokerage relationship between you and {legalName}, and the duties that come with it, are those stated in the written agreement you sign with us, such as the listing agreement.",
            ],
          },
        ],
      },
      {
        id: "commissions",
        heading: "3. Commissions Are Negotiable",
        body: [
          "Commissions are negotiable and are not set by law.",
          "Our published plans are our offer to sellers: a flat fee paid when you list, plus a {legalName} commission at closing of {essentialsPct}% (Essentials), {proPct}% (Pro) or {conciergePct}% (Concierge), paid only if the property sells. You are free to work with any other brokerage.",
        ],
      },
      {
        id: "buyer-compensation",
        heading: "4. Buyer's Agent Compensation",
        body: [
          buyerAgentComp.text.en.termsSummary,
          "Buyers who work with an agent usually sign their own written agreement with that agent, which states what the agent will be paid and by whom.",
        ],
      },
      {
        id: "fair-housing",
        heading: "5. Equal Housing Opportunity",
        body: [
          "{legalName} is an Equal Housing Opportunity brokerage. We are committed to the letter and the spirit of the federal Fair Housing Act and the Florida Fair Housing Act (Chapter 760, Florida Statutes).",
          "We do not discriminate, and we do not accept listings, instructions, advertising or communications that discriminate, in the sale or rental of housing on the basis of race, color, national origin, religion, sex, disability (handicap), or familial status, or any other characteristic protected by federal, state or local law, including local ordinances such as those of Miami-Dade County.",
          "We may refuse or remove any listing, description, photo or message that expresses a preference, limitation or discrimination prohibited by these laws.",
        ],
        sub: [
          {
            heading: "5.1 How to report housing discrimination",
            body: [
              "If you believe you have experienced housing discrimination, you can contact us at {supportEmail}. You may also file a complaint with the U.S. Department of Housing and Urban Development (HUD) or with the Florida Commission on Human Relations.",
            ],
          },
        ],
      },
      {
        id: "wire-fraud",
        heading: "6. Wire Fraud Warning",
        body: [
          "Criminals target real estate transactions by sending fake emails or text messages that look like they come from a broker, title company, attorney or lender, asking you to wire money or announcing \"new\" payment instructions.",
          "{legalName} will never ask you to send money by wire transfer through email or text message, and will never change payment or wiring instructions by email or text message. We charge our plan fees only through the secure checkout on our website.",
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
        ],
      },
    ],
  },
  es: {
    title: "Avisos de Corretaje, Vivienda Justa y Fraude",
    intro: [
      "En esta página reunimos los avisos que aplican a todas las personas que usan lixtara.com: quiénes somos como correduría, cómo funcionan las relaciones de corretaje en Florida, cómo se manejan las comisiones y la compensación al agente del comprador, nuestro compromiso con la vivienda justa, cómo protegerse del fraude por transferencia bancaria y cómo tratamos las referencias a proveedores de servicios de cierre.",
      "Estos avisos complementan nuestros Términos de Servicio y nuestra Política de Privacidad. No sustituyen las divulgaciones y los acuerdos escritos que usted recibe durante una transacción; si algo de lo que aquí se dice difiere de un acuerdo firmado, prevalece el acuerdo firmado.",
    ],
    sections: [
      {
        id: "brokerage",
        heading: "1. Quiénes Somos",
        body: [
          "{legalName} es una correduría inmobiliaria con licencia del Departamento de Regulación Comercial y Profesional de Florida como Real Estate Corporation, licencia FL #{brokerageLicense}. Nuestra corredora calificada es {brokerName}, Broker, licencia FL #{brokerLicense}. Nuestra oficina registrada está en {brokerageAddress}.",
          "\"Lixtara\" es la marca con la que {legalName} ofrece sus servicios.",
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
              "El tipo de relación de corretaje entre usted y {legalName}, y los deberes que conlleva, son los que constan en el acuerdo escrito que usted firma con nosotros, como el acuerdo de listado.",
            ],
          },
        ],
      },
      {
        id: "commissions",
        heading: "3. Las Comisiones Son Negociables",
        body: [
          "Las comisiones son negociables y no las fija la ley.",
          "Nuestros planes publicados son nuestra oferta a los vendedores: una tarifa fija que se paga al publicar, más una comisión de {legalName} al cierre del {essentialsPct}% (Essentials), del {proPct}% (Pro) o del {conciergePct}% (Concierge), que solo se paga si la propiedad se vende. Usted es libre de trabajar con cualquier otra correduría.",
        ],
      },
      {
        id: "buyer-compensation",
        heading: "4. Compensación al Agente del Comprador",
        body: [
          buyerAgentComp.text.es.termsSummary,
          "Los compradores que trabajan con un agente normalmente firman su propio acuerdo escrito con ese agente, en el que consta cuánto se le pagará y quién lo pagará.",
        ],
      },
      {
        id: "fair-housing",
        heading: "5. Igualdad de Oportunidades en la Vivienda",
        body: [
          "{legalName} es una correduría que ofrece igualdad de oportunidades en la vivienda (Equal Housing Opportunity). Nos comprometemos con la letra y el espíritu de la Ley federal de Vivienda Justa (Fair Housing Act) y de la Ley de Vivienda Justa de Florida (Capítulo 760 de los Estatutos de Florida).",
          "No discriminamos, ni aceptamos listados, instrucciones, anuncios o comunicaciones que discriminen, en la venta o el alquiler de viviendas por motivos de raza, color, origen nacional, religión, sexo, discapacidad o situación familiar, ni por ninguna otra característica protegida por la ley federal, estatal o local, incluidas ordenanzas locales como las del Condado de Miami-Dade.",
          "Podemos rechazar o retirar cualquier listado, descripción, foto o mensaje que exprese una preferencia, limitación o discriminación prohibida por estas leyes.",
        ],
        sub: [
          {
            heading: "5.1 Cómo denunciar discriminación en la vivienda",
            body: [
              "Si cree que ha sufrido discriminación en la vivienda, puede escribirnos a {supportEmail}. También puede presentar una queja ante el Departamento de Vivienda y Desarrollo Urbano de los EE. UU. (HUD) o ante la Comisión de Relaciones Humanas de Florida.",
            ],
          },
        ],
      },
      {
        id: "wire-fraud",
        heading: "6. Aviso de Fraude por Transferencia Bancaria",
        body: [
          "Los delincuentes atacan las operaciones inmobiliarias con correos o mensajes de texto falsos que parecen venir de un corredor, una compañía de títulos, un abogado o un prestamista, y que piden transferir dinero o anuncian \"nuevas\" instrucciones de pago.",
          "{legalName} nunca le pedirá que envíe dinero por transferencia bancaria mediante un correo o un mensaje de texto, y nunca cambiará instrucciones de pago o de transferencia por correo ni por mensaje de texto. Cobramos las tarifas de nuestros planes únicamente a través del pago seguro de nuestro sitio web.",
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
        ],
      },
    ],
  },
};
