import type { LegalContent } from "./types";

// BORRADOR 2026-10 para revisión del abogado de Lixtara. Marcadores: src/lib/legal/config.ts.
// Base de la sección "idx": los textos literales que muestra el sitio están en
// src/lib/mls/display-compliance.ts (reliabilityDisclaimer y mlsCopyrightNotice).
export const disclaimersDoc: LegalContent = {
  en: {
    title: "Disclaimers",
    intro: [
      "These Disclaimers explain important limits on the information, tools and services that {legalName} (\"Lixtara,\" \"we,\" \"us\" or \"our\") makes available through lixtara.com and related services (the \"Services\"). Lixtara is a licensed Florida real estate brokerage that combines tools for owners selling their own homes with licensed-broker support.",
      "These Disclaimers are part of, and should be read together with, our Terms of Service. By using the Services you acknowledge the limits described below.",
    ],
    sections: [
      {
        id: "no-advice",
        heading: "1. No Legal, Tax or Financial Advice",
        body: [
          "Information on the Services is general information. It is not legal, tax, accounting, financial, investment, lending, appraisal, inspection or survey advice, and Lixtara is not a law firm, tax advisor, lender, appraiser, inspector, surveyor, or title or escrow company.",
          "Real estate transactions have significant legal and financial consequences. Before making a decision, get independent advice from qualified professionals.",
        ],
        bullets: [
          "An attorney, for contracts, disclosures, title and legal questions.",
          "A tax advisor or accountant, for the tax consequences of a sale or purchase.",
          "A lender or financial professional, for financing and affordability.",
          "A licensed appraiser or home inspector, for a property's value and condition.",
        ],
      },
      {
        id: "no-guarantee",
        heading: "2. No Guarantee of Sale, Price or Timing",
        body: [
          "{legalName} does not guarantee that a property will sell, that it will sell at any price, or that it will sell within any period. Results depend on the market, the price, the property's condition, buyer demand, financing and other factors outside our control. General market information and past results are not a promise of future results.",
          "Pricing suggestions, marketing recommendations and strategy guidance are informational. The brokerage services you receive, and the duties we owe you, are those stated in the listing agreement you sign and in Florida law. See our Brokerage, Fair Housing & Fraud Notices for how brokerage relationships work in Florida.",
          "{legalName} is a Real Estate Corporation licensed in Florida, FL #{brokerageLicense}; qualifying broker {brokerName}, FL #{brokerLicense}.",
        ],
      },
      {
        id: "idx",
        heading: "3. MLS and IDX Listing Information",
        body: [
          "Listings from other brokerages shown on the Services come from the multiple listing service operated by MIAMI Association of REALTORS® (Southeast Florida MLS, \"SEFMLS\") through Internet Data Exchange (IDX). Wherever that content appears, we display the notices the MLS requires: that the MLS data is deemed reliable but is not guaranteed accurate by MIAMI REALTORS®, the SEFMLS copyright notice for the current year, and the name of the brokerage that holds each listing.",
          "IDX information is provided exclusively for consumers' personal, non-commercial use, solely to identify properties that consumers may be interested in purchasing. Any other use, including copying, redistributing or using it to build a database, is prohibited and may violate federal and state law. Listing information, including square footage, lot size, school assignments and prices, may be inaccurate, incomplete or out of date; verify every fact independently.",
          "Properties may have been sold, withdrawn or changed since the data was last updated. [VERIFICAR: official IDX disclaimer text and placement required by the MIAMI REALTORS® IDX rules and the SEFMLS data license (Schedules A and C), including whether a Spanish version of the copyright notice is required — the site currently shows the copyright notice in English only — and whether a \"last updated\" timestamp must be shown.]",
        ],
      },
      {
        id: "valuations",
        heading: "4. Price Estimates and Comparable Sales",
        body: [
          "Price ranges, value estimates and comparable sales shown on the Services are produced automatically with data from Rentcast and our own calculations. They are estimates for general information only.",
          "They are not an appraisal, a broker price opinion (BPO), a comparative market analysis prepared by a licensee for a specific transaction, or a guarantee of value. They may be inaccurate, incomplete or out of date and may not reflect the property's condition, improvements or current market. Do not rely on them to set a price, obtain financing or make an investment decision without independent verification.",
        ],
      },
      {
        id: "public-records",
        heading: "5. Public Records and Autofill",
        body: [
          "When you enter an address, we may fill in property facts (bedrooms, bathrooms, square footage, lot size, year built, property type, folio, legal description and an estimated annual tax) from the public records of the Miami-Dade County Property Appraiser. Tax figures are an estimate based on the most recent taxable value and an average millage rate; the actual tax bill may differ.",
          "Public records can be incomplete, outdated or wrong, and an address can match a different parcel (for example, another unit in the same building). You are responsible for reviewing and correcting every prefilled field before you publish or sign. The legal description and folio used in your listing agreement must match your deed and title records.",
        ],
      },
      {
        id: "ai",
        heading: "6. Artificial Intelligence",
        body: [
          "Loui, our AI assistant, answers automatically. Its answers are general information, not legal, tax, financial or real estate brokerage advice, and they may be wrong, incomplete or out of date. Loui is not a person and is not a licensed professional. Do not rely on Loui for a decision with legal or financial consequences; check with your broker, your own professionals, your signed agreements and official sources.",
          "Listing descriptions improved with AI are suggestions. You must review them, make sure every statement is true and complete, and correct anything that is not before publishing; you remain responsible for the content of your listing.",
          "Virtual staging and AI motion video (\"Living Listing\") are illustrative. They are labeled as such, do not show the property's actual condition, furnishings or features, and must not be relied upon as a representation of the property. Original, unedited photos are available on request; inspect the property in person before making any decision.",
        ],
      },
      {
        id: "fair-housing",
        heading: "7. Fair Housing",
        body: [
          "{legalName} is an Equal Housing Opportunity brokerage. Listings and messages on the Services must not express any preference, limitation or discrimination prohibited by federal, state or local fair-housing laws, and we may remove any content that does. See our Brokerage, Fair Housing & Fraud Notices for details and how to report discrimination.",
        ],
      },
      {
        id: "third-parties",
        heading: "8. Third-Party Information, Links and Services",
        body: [
          "The Services include information, tools and links from third parties, such as data providers, payment processing, electronic signature, maps and email. We do not control, and are not responsible for, the accuracy, availability or practices of third-party information or services. A link or reference is not an endorsement, and your use of a third-party service is governed by its own terms and privacy policy.",
        ],
      },
      {
        id: "as-is",
        heading: "9. \"As Is\" and No Warranty",
        body: [
          "The Services and the information on them are provided \"as is\" and \"as available,\" without warranties of any kind, express, implied or statutory, to the fullest extent permitted by law, including warranties of merchantability, fitness for a particular purpose, title, non-infringement, accuracy and uninterrupted or error-free operation.",
        ],
      },
      {
        id: "liability",
        heading: "10. Limitation of Liability",
        body: [
          "To the maximum extent permitted by law, {legalName} and its officers, employees and agents are not liable for loss or damage arising from your use of, or reliance on, the Services or the information on them. These Disclaimers do not expand any liability and are subject to the limitation-of-liability terms of our Terms of Service.",
        ],
      },
      {
        id: "contact",
        heading: "11. Contact",
        body: [
          "Questions about these Disclaimers: {legalName}, {brokerageAddress}. Email: {supportEmail}.",
        ],
      },
    ],
  },
  es: {
    title: "Avisos Legales",
    intro: [
      "Estos Avisos Legales explican límites importantes de la información, las herramientas y los servicios que {legalName} (\"Lixtara\", \"nosotros\" o \"nuestro\") ofrece en lixtara.com y en los servicios relacionados (los \"Servicios\"). Lixtara es una correduría inmobiliaria con licencia en Florida que combina herramientas para que los propietarios vendan su propia vivienda con el respaldo de una corredora con licencia.",
      "Estos Avisos Legales forman parte de nuestros Términos de Servicio y deben leerse junto con ellos. Al usar los Servicios, usted reconoce los límites que se describen a continuación.",
    ],
    sections: [
      {
        id: "no-advice",
        heading: "1. No Ofrecemos Asesoría Legal, Fiscal ni Financiera",
        body: [
          "La información de los Servicios es información general. No es asesoría legal, fiscal, contable, financiera, de inversión, hipotecaria, de tasación, de inspección ni de agrimensura, y Lixtara no es un bufete de abogados, un asesor fiscal, un prestamista, un tasador, un inspector, un agrimensor ni una compañía de títulos o de depósito en garantía (escrow).",
          "Las operaciones inmobiliarias tienen consecuencias legales y económicas importantes. Antes de tomar una decisión, consulte a profesionales calificados e independientes.",
        ],
        bullets: [
          "A un abogado, sobre contratos, divulgaciones, títulos y cuestiones legales.",
          "A un asesor fiscal o contador, sobre las consecuencias tributarias de una venta o una compra.",
          "A un prestamista o profesional financiero, sobre financiamiento y capacidad de pago.",
          "A un tasador o inspector con licencia, sobre el valor y el estado de una propiedad.",
        ],
      },
      {
        id: "no-guarantee",
        heading: "2. No Garantizamos la Venta, el Precio ni los Plazos",
        body: [
          "{legalName} no garantiza que una propiedad se venda, que se venda a un precio determinado ni que se venda dentro de un plazo determinado. El resultado depende del mercado, del precio, del estado de la propiedad, de la demanda, del financiamiento y de otros factores que no controlamos. La información general del mercado y los resultados anteriores no son una promesa de resultados futuros.",
          "Las sugerencias de precio, las recomendaciones de promoción y las orientaciones de estrategia son informativas. Los servicios de corretaje que usted recibe, y los deberes que tenemos con usted, son los que establecen el contrato de listado que usted firma y la ley de Florida. En nuestros Avisos de Corretaje, Vivienda Justa y Fraude explicamos cómo funcionan las relaciones de corretaje en Florida.",
          "{legalName} es una Real Estate Corporation con licencia en Florida, FL #{brokerageLicense}; corredora calificada: {brokerName}, FL #{brokerLicense}.",
        ],
      },
      {
        id: "idx",
        heading: "3. Información de Listados del MLS e IDX",
        body: [
          "Los listados de otras corredurías que aparecen en los Servicios provienen del servicio de listados múltiples que opera MIAMI Association of REALTORS® (Southeast Florida MLS, \"SEFMLS\"), mediante el intercambio de datos por internet (IDX). Donde aparece ese contenido mostramos los avisos que exige el MLS: que los datos del MLS se consideran confiables pero MIAMI REALTORS® no garantiza su exactitud, el aviso de derechos de autor de SEFMLS del año en curso y el nombre de la correduría titular de cada listado.",
          "La información IDX se ofrece exclusivamente para el uso personal y no comercial de los consumidores, con el único fin de identificar propiedades que podrían interesarles comprar. Cualquier otro uso, incluido copiarla, redistribuirla o usarla para formar una base de datos, está prohibido y puede infringir leyes federales y estatales. La información de los listados, incluidos los pies cuadrados, el tamaño del lote, la asignación de escuelas y los precios, puede ser inexacta, incompleta o estar desactualizada; verifique cada dato por su cuenta.",
          "Las propiedades pueden haberse vendido, retirado o modificado desde la última actualización de los datos. [VERIFICAR: texto oficial y ubicación del aviso IDX que exigen las reglas IDX de MIAMI REALTORS® y la licencia de datos de SEFMLS (Anexos A y C), incluido si se requiere una versión en español del aviso de derechos de autor —hoy el sitio lo muestra solo en inglés— y si debe mostrarse la fecha de la última actualización.]",
        ],
      },
      {
        id: "valuations",
        heading: "4. Estimaciones de Precio y Ventas Comparables",
        body: [
          "Los rangos de precio, las estimaciones de valor y las ventas comparables que aparecen en los Servicios se generan de forma automática con datos de Rentcast y cálculos propios. Son estimaciones de carácter informativo.",
          "No son una tasación, una opinión de precio de un corredor (BPO), un análisis comparativo de mercado preparado por un profesional con licencia para una operación concreta ni una garantía de valor. Pueden ser inexactas, estar incompletas o desactualizadas y no reflejar el estado de la propiedad, sus mejoras ni el mercado actual. No las use para fijar un precio, obtener financiamiento o tomar una decisión de inversión sin verificarlas por su cuenta.",
        ],
      },
      {
        id: "public-records",
        heading: "5. Registros Públicos y Autocompletado",
        body: [
          "Cuando usted ingresa una dirección, podemos completar datos de la propiedad (habitaciones, baños, pies cuadrados, tamaño del lote, año de construcción, tipo de propiedad, número de folio, descripción legal y un impuesto anual estimado) con los registros públicos del Tasador de Propiedades del Condado de Miami-Dade. El impuesto es una estimación basada en el último valor imponible y una tasa de millaje promedio; la factura real puede ser distinta.",
          "Los registros públicos pueden estar incompletos, desactualizados o contener errores, y una dirección puede coincidir con otra parcela (por ejemplo, otra unidad del mismo edificio). Usted es responsable de revisar y corregir cada campo autocompletado antes de publicar o firmar. La descripción legal y el folio de su contrato de listado deben coincidir con su escritura y con los registros del título.",
        ],
      },
      {
        id: "ai",
        heading: "6. Inteligencia Artificial",
        body: [
          "Loui, nuestro asistente de inteligencia artificial, responde de forma automática. Sus respuestas son información general, no asesoría legal, fiscal, financiera ni de corretaje inmobiliario, y pueden ser erróneas, incompletas o estar desactualizadas. Loui no es una persona ni un profesional con licencia. No tome decisiones con consecuencias legales o económicas basándose en Loui; consulte a su corredora, a sus propios profesionales, sus acuerdos firmados y las fuentes oficiales.",
          "Las descripciones de listados mejoradas con inteligencia artificial son sugerencias. Usted debe revisarlas, asegurarse de que cada afirmación sea verdadera y completa y corregir lo que no lo sea antes de publicar; usted sigue siendo responsable del contenido de su listado.",
          "La ambientación virtual (virtual staging) y el video con movimiento generado por inteligencia artificial (\"Living Listing\") son ilustrativos. Están identificados como tales, no muestran el estado, los muebles ni las características reales de la propiedad y no deben tomarse como una descripción de ella. Las fotos originales, sin editar, están disponibles a solicitud; visite la propiedad en persona antes de tomar cualquier decisión.",
        ],
      },
      {
        id: "fair-housing",
        heading: "7. Vivienda Justa",
        body: [
          "{legalName} es una correduría que ofrece igualdad de oportunidades en la vivienda. Los listados y mensajes de los Servicios no pueden expresar preferencias, limitaciones ni discriminación prohibidas por las leyes federales, estatales o locales de vivienda justa, y podemos retirar el contenido que lo haga. En nuestros Avisos de Corretaje, Vivienda Justa y Fraude encontrará más detalles y cómo denunciar una discriminación.",
        ],
      },
      {
        id: "third-parties",
        heading: "8. Información, Enlaces y Servicios de Terceros",
        body: [
          "Los Servicios incluyen información, herramientas y enlaces de terceros, como proveedores de datos, procesamiento de pagos, firma electrónica, mapas y correo electrónico. No controlamos la exactitud, la disponibilidad ni las prácticas de la información o los servicios de terceros, ni somos responsables de ellas. Un enlace o una mención no implica respaldo, y el uso de un servicio de terceros se rige por sus propios términos y su política de privacidad.",
        ],
      },
      {
        id: "as-is",
        heading: "9. \"Tal Cual\" y Sin Garantía",
        body: [
          "Los Servicios y la información que contienen se ofrecen \"tal cual\" y \"según disponibilidad\", sin garantías de ningún tipo, expresas, implícitas o legales, en la mayor medida que permita la ley, incluidas las garantías de comerciabilidad, idoneidad para un fin determinado, titularidad, no infracción, exactitud y funcionamiento ininterrumpido o sin errores.",
        ],
      },
      {
        id: "liability",
        heading: "10. Limitación de Responsabilidad",
        body: [
          "En la mayor medida que permita la ley, {legalName} y sus directivos, empleados y agentes no son responsables de las pérdidas o los daños que resulten del uso de los Servicios o de la confianza depositada en su información. Estos Avisos Legales no amplían ninguna responsabilidad y están sujetos a las cláusulas de limitación de responsabilidad de nuestros Términos de Servicio.",
        ],
      },
      {
        id: "contact",
        heading: "11. Contacto",
        body: [
          "Consultas sobre estos Avisos Legales: {legalName}, {brokerageAddress}. Correo electrónico: {supportEmail}.",
        ],
      },
    ],
  },
};
