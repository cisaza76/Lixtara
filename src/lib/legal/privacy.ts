import type { LegalContent } from "./types";

export const privacyDoc: LegalContent = {
  en: {
    title: "Privacy Policy",
    intro: [
      "This Privacy Policy explains how Lixtara collects, uses, shares, and protects information about you when you use our website, platform, and related services (the \"Service\"). Lixtara is a Miami, Florida-based real-estate technology platform that connects sellers who list their own homes with buyers who make offers, and supports the e-signing of real-estate agreements.",
      "Lixtara is operated by [LIXTARA LEGAL ENTITY NAME]. By accessing or using the Service, you acknowledge that you have read and understood this Privacy Policy. If you do not agree with our practices, please do not use the Service.",
      "We are a United States-based company, and we process information in the United States. Please read this Policy together with our Terms of Service and our Cookie Policy.",
    ],
    sections: [
      {
        heading: "1. Introduction and Scope",
        body: [
          "This Privacy Policy applies to personal information we collect through the Lixtara website, web application, and any associated features, including our seller listing tools, buyer offer tools, the \"Loui\" AI assistant, virtual staging, and the \"Living Listing\" feature.",
          "This Policy describes the categories of information we collect, how we use and disclose that information, the third-party service providers we rely on, and the choices and rights available to you. It does not apply to the practices of third parties that we do not own or control, including service providers and other companies whose own privacy policies govern their handling of your information.",
          "Terms such as \"we,\" \"us,\" and \"our\" refer to Lixtara. \"You\" refers to any individual who uses the Service, whether as a seller, buyer, visitor, or other user.",
        ],
      },
      {
        heading: "2. Information We Collect",
        body: [
          "We collect information that you provide to us directly, information we collect automatically when you use the Service, and information we receive from third parties. The categories below describe the information we may collect.",
        ],
        sub: [
          {
            heading: "2.1 Information You Provide to Us",
            body: [
              "We collect the information you provide when you create an account, list a property, make or respond to an offer, complete a transaction, sign agreements, or otherwise communicate with us.",
            ],
            bullets: [
              "Account information: your name, email address, and password, and any profile details you choose to add.",
              "Property and listing details: information about the homes you list, including address, descriptions, features, pricing, and photographs and other media you upload.",
              "Offer and transaction information: details related to offers you make or receive, counteroffers, and the progress and terms of a real-estate transaction.",
              "Payment information: payment details you provide when you purchase a plan or service. Payments are processed by our payment provider, Stripe. Lixtara does not store full payment card numbers.",
              "Identity and signature information: information used to verify your identity and capture your electronic signature on agreements, handled through our e-signature provider, DocuSign.",
              "Communications: the content of messages you send to us, including support requests and conversations with the Loui AI assistant.",
            ],
          },
          {
            heading: "2.2 Information We Collect Automatically",
            body: [
              "When you use the Service, we and our service providers automatically collect certain information about your device and how you interact with the Service.",
            ],
            bullets: [
              "Usage data: pages and features you view, actions you take, search queries, and timestamps of your activity.",
              "Device data: your IP address, browser type, operating system, device identifiers, and similar technical information.",
              "Cookies and similar technologies: information collected through cookies and comparable technologies, as described in Section 6 and in our separate Cookie Policy.",
              "Address and location data: location information associated with the listings you create and view, used to display properties and render maps.",
            ],
          },
          {
            heading: "2.3 Information We Receive from Third Parties",
            body: [
              "We may receive information about a property or transaction from third parties to support the Service.",
            ],
            bullets: [
              "Public property records: property records obtained from the Miami-Dade County Property Appraiser to help describe and verify listings.",
              "Property value estimates: estimated property values and related data obtained from Rentcast.",
            ],
          },
        ],
      },
      {
        heading: "3. How We Use Your Information",
        body: [
          "We use the information we collect for the following purposes:",
        ],
        bullets: [
          "To provide, operate, and maintain the Service and to create and manage your account.",
          "To process and display property listings, facilitate offers and counteroffers, and support the progress of real-estate transactions.",
          "To process payments for plans and services through our payment provider.",
          "To enable the electronic signing of real-estate agreements and to maintain related signature and identity records.",
          "To facilitate broker support and the licensed-broker functions of the platform.",
          "To power AI features, including the Loui AI assistant, virtual staging, and the Living Listing feature.",
          "To protect the security and integrity of the Service, detect and prevent fraud and abuse, and enforce our terms.",
          "To communicate with you, including sending transactional messages, responding to inquiries, and providing customer support.",
          "To comply with our legal obligations and respond to lawful requests.",
          "To analyze, improve, and develop the Service and its features.",
        ],
      },
      {
        heading: "4. How We Share Your Information",
        body: [
          "We share information in the circumstances described below. We do not sell your personal information for money.",
        ],
        sub: [
          {
            heading: "4.1 Service Providers and Sub-Processors",
            body: [
              "We share information with trusted service providers who process information on our behalf to deliver the Service. These providers are authorized to use your information only as necessary to provide services to us. They include:",
            ],
            bullets: [
              "Supabase, for authentication, database hosting, and file storage.",
              "Stripe, for payment processing.",
              "DocuSign, for electronic signature of agreements.",
              "Resend, for sending transactional email.",
              "Mapbox and Google Maps, for maps and geocoding.",
              "Rentcast, for property value estimates.",
              "Miami-Dade County Property Appraiser, for public property records lookup.",
              "Anthropic, the AI provider that powers the Loui AI assistant.",
              "Luma, for AI image and video generation used in virtual staging and the Living Listing feature.",
              "Upstash, for rate-limiting and abuse protection.",
              "Vercel, for hosting the Service.",
            ],
          },
          {
            heading: "4.2 Parties to Your Real-Estate Transaction",
            body: [
              "Because Lixtara facilitates real-estate transactions, we share relevant information with the parties to your transaction. Depending on your role, this may include the broker, buyers and their agents, sellers, and title or escrow providers, as needed to negotiate, document, and complete the transaction.",
            ],
          },
          {
            heading: "4.3 Legal and Safety",
            body: [
              "We may disclose information when we believe it is necessary to comply with applicable law, regulation, legal process, or a governmental request; to enforce our agreements; or to protect the rights, property, safety, or security of Lixtara, our users, or the public.",
            ],
          },
          {
            heading: "4.4 Business Transfers",
            body: [
              "If Lixtara is involved in a merger, acquisition, financing, reorganization, sale of assets, or similar transaction, your information may be transferred as part of that transaction, subject to this Privacy Policy.",
            ],
          },
          {
            heading: "4.5 With Your Direction",
            body: [
              "We may share your information with other parties when you direct us to do so or otherwise consent to the sharing.",
            ],
          },
          {
            heading: "4.6 No Sale of Personal Information; Sharing and Targeted Advertising",
            body: [
              "Lixtara does not sell your personal information for money. We do not currently share your personal information for cross-context behavioral or targeted advertising, and we do not engage in targeted advertising of this kind. If our practices change, we will update this Policy and provide any rights and choices required by law.",
            ],
          },
        ],
      },
      {
        heading: "5. AI Processing of Your Content",
        body: [
          "When you use our AI features, the text and images you submit are processed by our AI providers to generate responses and content. Specifically:",
          "When you chat with the Loui AI assistant, your messages are sent to Anthropic to generate responses. When you use virtual staging or the Living Listing feature, the images and related inputs you submit are sent to Luma to generate staged images or video content.",
          "AI-generated outputs, including staged images and Living Listing media, are illustrative and intended to help visualize possibilities. They may not accurately reflect the actual condition, dimensions, or features of a property and should not be relied upon as a factual representation. Do not submit information through AI features that you do not wish to be processed for these purposes.",
        ],
      },
      {
        heading: "6. Cookies and Similar Technologies",
        body: [
          "We and our service providers use cookies and similar technologies to operate the Service, remember your preferences, keep you signed in, understand how the Service is used, and improve it.",
          "For a detailed description of the cookies and similar technologies we use and the choices available to you, please see our separate Cookie Policy.",
        ],
      },
      {
        heading: "7. Data Retention",
        body: [
          "We retain personal information for as long as necessary to provide the Service, maintain your account, complete and document real-estate transactions, comply with our legal and recordkeeping obligations, resolve disputes, and enforce our agreements.",
          "When information is no longer needed for these purposes, we take reasonable steps to delete it or to anonymize or de-identify it. Retention periods vary depending on the type of information and the purpose for which it was collected.",
        ],
      },
      {
        heading: "8. Data Security",
        body: [
          "We use reasonable administrative, technical, and organizational measures designed to protect personal information against loss, misuse, and unauthorized access, disclosure, alteration, and destruction. We rely on established service providers, and we apply access controls and other safeguards appropriate to the nature of the information.",
          "However, no method of transmission over the Internet or method of electronic storage is completely secure. We cannot guarantee the absolute security of your information, and you provide it at your own risk. If you have reason to believe that your interaction with us is no longer secure, please contact us immediately.",
        ],
      },
      {
        heading: "9. Your Privacy Rights",
        body: [
          "Depending on where you live and subject to applicable law, you may have rights regarding your personal information, including the right to access the information we hold about you, to correct inaccurate information, to request deletion, to obtain a copy of certain information in a portable format, and to opt out of certain processing.",
          "To exercise your rights, contact us at privacy@lixtara.com. We may need to verify your identity before fulfilling your request, including by asking you to confirm information associated with your account, in order to protect your information from unauthorized access.",
        ],
        sub: [
          {
            heading: "9.1 California Residents",
            body: [
              "If you are a California resident, the California Consumer Privacy Act (CCPA), as amended by the California Privacy Rights Act (CPRA), provides you with certain rights regarding your personal information. These include the right to know what personal information we collect, use, and disclose; the right to request deletion of your personal information; the right to correct inaccurate personal information; the right to opt out of the sale or sharing of personal information; and the right not to be discriminated against for exercising your rights.",
              "As stated above, Lixtara does not sell your personal information for money and does not currently share personal information for cross-context behavioral advertising. To exercise your California rights, contact us at privacy@lixtara.com.",
            ],
          },
          {
            heading: "9.2 Florida Residents",
            body: [
              "If you are a Florida resident, the Florida Digital Bill of Rights may provide you with certain rights regarding your personal information, which may include rights to access, correct, delete, and obtain a copy of your personal information, and to opt out of certain processing. To exercise these rights, contact us at privacy@lixtara.com.",
            ],
          },
        ],
      },
      {
        heading: "10. Children's Privacy",
        body: [
          "The Service is intended for adults who are at least 18 years old. It is not directed to children, and we do not knowingly collect personal information from children. If you believe that a child has provided us with personal information, please contact us at privacy@lixtara.com, and we will take appropriate steps to delete it.",
        ],
      },
      {
        heading: "11. International Users and Data Transfers",
        body: [
          "Lixtara is based in the United States, and we process and store information in the United States. If you access the Service from outside the United States, you understand that your information will be transferred to and processed in the United States, where data protection laws may differ from those in your jurisdiction.",
          "If you are located in a jurisdiction governed by laws such as the EU General Data Protection Regulation (GDPR), please be aware that, by using the Service, you direct us to process your information in the United States as described in this Policy.",
        ],
      },
      {
        heading: "12. Do Not Track",
        body: [
          "Some browsers offer a \"Do Not Track\" signal. Because there is no consistent industry standard for how to respond to these signals, the Service does not currently respond to Do Not Track signals. We will continue to monitor developments in this area.",
        ],
      },
      {
        heading: "13. Third-Party Links and Services",
        body: [
          "The Service may contain links to third-party websites, products, or services that we do not own or control, and it relies on third-party providers as described in this Policy. We are not responsible for the privacy practices of these third parties. We encourage you to review the privacy policies of any third-party services you access.",
        ],
      },
      {
        heading: "14. Changes to This Policy",
        body: [
          "We may update this Privacy Policy from time to time to reflect changes in our practices, technology, legal requirements, or other factors. When we make changes, we will revise the date associated with this Policy and, where appropriate, provide additional notice. Your continued use of the Service after an update becomes effective constitutes your acceptance of the revised Policy.",
        ],
      },
      {
        heading: "15. Contact Us and How to Exercise Your Rights",
        body: [
          "If you have questions about this Privacy Policy or our privacy practices, or if you wish to exercise your privacy rights, please contact us:",
          "By email for privacy matters: privacy@lixtara.com",
          "By email for general support: support@lixtara.com",
          "By mail: [LIXTARA LEGAL ENTITY NAME], [MAILING ADDRESS]",
          "Attention: [DATA PROTECTION CONTACT]",
          "To submit a request to access, correct, delete, or otherwise exercise your rights, please email privacy@lixtara.com with details of your request. We may need to verify your identity before processing your request.",
        ],
      },
    ],
  },
  es: {
    title: "Política de Privacidad",
    intro: [
      "Esta Política de Privacidad explica cómo Lixtara recopila, usa, comparte y protege la información sobre usted cuando utiliza nuestro sitio web, plataforma y servicios relacionados (el \"Servicio\"). Lixtara es una plataforma de tecnología inmobiliaria con sede en Miami, Florida, que conecta a vendedores que publican sus propias viviendas con compradores que presentan ofertas, y facilita la firma electrónica de acuerdos inmobiliarios.",
      "Lixtara es operada por [LIXTARA LEGAL ENTITY NAME]. Al acceder o utilizar el Servicio, usted reconoce que ha leído y comprendido esta Política de Privacidad. Si no está de acuerdo con nuestras prácticas, por favor no utilice el Servicio.",
      "Somos una empresa con sede en los Estados Unidos y procesamos la información en los Estados Unidos. Le pedimos que lea esta Política junto con nuestros Términos de Servicio y nuestra Política de Cookies.",
    ],
    sections: [
      {
        heading: "1. Introducción y Alcance",
        body: [
          "Esta Política de Privacidad se aplica a la información personal que recopilamos a través del sitio web, la aplicación web y cualquier función asociada de Lixtara, incluidas nuestras herramientas de publicación para vendedores, las herramientas de ofertas para compradores, el asistente de IA \"Loui\", la preparación virtual de espacios (\"virtual staging\") y la función \"Living Listing\".",
          "Esta Política describe las categorías de información que recopilamos, cómo usamos y divulgamos dicha información, los proveedores de servicios externos en los que nos apoyamos y las opciones y derechos disponibles para usted. No se aplica a las prácticas de terceros que no poseemos ni controlamos, incluidos los proveedores de servicios y otras empresas cuyas propias políticas de privacidad rigen el tratamiento de su información.",
          "Los términos como \"nosotros\" y \"nuestro\" se refieren a Lixtara. \"Usted\" se refiere a cualquier persona que utilice el Servicio, ya sea como vendedor, comprador, visitante u otro usuario.",
        ],
      },
      {
        heading: "2. Información que Recopilamos",
        body: [
          "Recopilamos la información que usted nos proporciona directamente, la información que recopilamos automáticamente cuando utiliza el Servicio y la información que recibimos de terceros. Las categorías a continuación describen la información que podemos recopilar.",
        ],
        sub: [
          {
            heading: "2.1 Información que Usted nos Proporciona",
            body: [
              "Recopilamos la información que usted proporciona cuando crea una cuenta, publica una propiedad, presenta o responde a una oferta, completa una transacción, firma acuerdos o se comunica con nosotros de otra manera.",
            ],
            bullets: [
              "Información de la cuenta: su nombre, dirección de correo electrónico y contraseña, así como cualquier detalle de perfil que decida agregar.",
              "Detalles de la propiedad y la publicación: información sobre las viviendas que publica, incluidos la dirección, las descripciones, las características, los precios, y las fotografías y demás contenido que cargue.",
              "Información de ofertas y transacciones: detalles relacionados con las ofertas que presenta o recibe, las contraofertas, y el progreso y los términos de una transacción inmobiliaria.",
              "Información de pago: los datos de pago que proporciona cuando adquiere un plan o servicio. Los pagos son procesados por nuestro proveedor de pagos, Stripe. Lixtara no almacena los números completos de las tarjetas de pago.",
              "Información de identidad y firma: la información utilizada para verificar su identidad y capturar su firma electrónica en los acuerdos, gestionada a través de nuestro proveedor de firma electrónica, DocuSign.",
              "Comunicaciones: el contenido de los mensajes que nos envía, incluidas las solicitudes de soporte y las conversaciones con el asistente de IA Loui.",
            ],
          },
          {
            heading: "2.2 Información que Recopilamos Automáticamente",
            body: [
              "Cuando utiliza el Servicio, nosotros y nuestros proveedores de servicios recopilamos automáticamente cierta información sobre su dispositivo y sobre cómo interactúa con el Servicio.",
            ],
            bullets: [
              "Datos de uso: las páginas y funciones que visualiza, las acciones que realiza, las consultas de búsqueda y las marcas de tiempo de su actividad.",
              "Datos del dispositivo: su dirección IP, tipo de navegador, sistema operativo, identificadores de dispositivo e información técnica similar.",
              "Cookies y tecnologías similares: información recopilada mediante cookies y tecnologías comparables, según se describe en la Sección 6 y en nuestra Política de Cookies independiente.",
              "Datos de dirección y ubicación: información de ubicación asociada con las publicaciones que crea y visualiza, utilizada para mostrar propiedades y representar mapas.",
            ],
          },
          {
            heading: "2.3 Información que Recibimos de Terceros",
            body: [
              "Podemos recibir información sobre una propiedad o transacción de terceros para apoyar el Servicio.",
            ],
            bullets: [
              "Registros públicos de propiedad: registros de propiedad obtenidos del Tasador de Propiedades del Condado de Miami-Dade (Miami-Dade County Property Appraiser) para ayudar a describir y verificar las publicaciones.",
              "Estimaciones de valor de la propiedad: valores estimados de propiedad y datos relacionados obtenidos de Rentcast.",
            ],
          },
        ],
      },
      {
        heading: "3. Cómo Usamos su Información",
        body: [
          "Usamos la información que recopilamos para los siguientes fines:",
        ],
        bullets: [
          "Para proporcionar, operar y mantener el Servicio, y para crear y administrar su cuenta.",
          "Para procesar y mostrar las publicaciones de propiedades, facilitar las ofertas y contraofertas, y apoyar el progreso de las transacciones inmobiliarias.",
          "Para procesar los pagos de planes y servicios a través de nuestro proveedor de pagos.",
          "Para habilitar la firma electrónica de acuerdos inmobiliarios y mantener los registros de firma e identidad relacionados.",
          "Para facilitar el soporte de corredores (brokers) y las funciones de corredor con licencia de la plataforma.",
          "Para impulsar las funciones de IA, incluido el asistente de IA Loui, la preparación virtual de espacios y la función Living Listing.",
          "Para proteger la seguridad y la integridad del Servicio, detectar y prevenir el fraude y el abuso, y hacer cumplir nuestros términos.",
          "Para comunicarnos con usted, incluido el envío de mensajes transaccionales, la respuesta a consultas y la prestación de soporte al cliente.",
          "Para cumplir con nuestras obligaciones legales y responder a solicitudes lícitas.",
          "Para analizar, mejorar y desarrollar el Servicio y sus funciones.",
        ],
      },
      {
        heading: "4. Cómo Compartimos su Información",
        body: [
          "Compartimos información en las circunstancias que se describen a continuación. No vendemos su información personal por dinero.",
        ],
        sub: [
          {
            heading: "4.1 Proveedores de Servicios y Subencargados del Tratamiento",
            body: [
              "Compartimos información con proveedores de servicios de confianza que procesan información en nuestro nombre para prestar el Servicio. Estos proveedores están autorizados a usar su información únicamente en la medida necesaria para prestarnos servicios. Incluyen:",
            ],
            bullets: [
              "Supabase, para autenticación, alojamiento de la base de datos y almacenamiento de archivos.",
              "Stripe, para el procesamiento de pagos.",
              "DocuSign, para la firma electrónica de acuerdos.",
              "Resend, para el envío de correo electrónico transaccional.",
              "Mapbox y Google Maps, para mapas y geocodificación.",
              "Rentcast, para estimaciones de valor de propiedades.",
              "Tasador de Propiedades del Condado de Miami-Dade, para la consulta de registros públicos de propiedad.",
              "Anthropic, el proveedor de IA que impulsa el asistente de IA Loui.",
              "Luma, para la generación de imágenes y video con IA utilizada en la preparación virtual de espacios y la función Living Listing.",
              "Upstash, para la limitación de tasa (rate-limiting) y la protección contra abusos.",
              "Vercel, para el alojamiento del Servicio.",
            ],
          },
          {
            heading: "4.2 Partes de su Transacción Inmobiliaria",
            body: [
              "Debido a que Lixtara facilita transacciones inmobiliarias, compartimos la información pertinente con las partes de su transacción. Según su función, esto puede incluir al corredor, a los compradores y sus agentes, a los vendedores, y a los proveedores de título o custodia (title o escrow), según sea necesario para negociar, documentar y completar la transacción.",
            ],
          },
          {
            heading: "4.3 Asuntos Legales y de Seguridad",
            body: [
              "Podemos divulgar información cuando creemos que es necesario para cumplir con la ley, la regulación, un proceso legal o una solicitud gubernamental aplicables; para hacer cumplir nuestros acuerdos; o para proteger los derechos, la propiedad, la seguridad o la protección de Lixtara, nuestros usuarios o el público.",
            ],
          },
          {
            heading: "4.4 Transferencias Comerciales",
            body: [
              "Si Lixtara participa en una fusión, adquisición, financiación, reorganización, venta de activos o transacción similar, su información podrá ser transferida como parte de esa transacción, sujeta a esta Política de Privacidad.",
            ],
          },
          {
            heading: "4.5 Con su Indicación",
            body: [
              "Podemos compartir su información con otras partes cuando usted nos indique que lo hagamos o consienta de otro modo a dicha divulgación.",
            ],
          },
          {
            heading: "4.6 Ausencia de Venta de Información Personal; Compartición y Publicidad Dirigida",
            body: [
              "Lixtara no vende su información personal por dinero. Actualmente no compartimos su información personal para publicidad conductual de contexto cruzado o publicidad dirigida, y no realizamos publicidad dirigida de este tipo. Si nuestras prácticas cambian, actualizaremos esta Política y proporcionaremos los derechos y opciones que exija la ley.",
            ],
          },
        ],
      },
      {
        heading: "5. Procesamiento de su Contenido por IA",
        body: [
          "Cuando utiliza nuestras funciones de IA, el texto y las imágenes que envía son procesados por nuestros proveedores de IA para generar respuestas y contenido. En concreto:",
          "Cuando conversa con el asistente de IA Loui, sus mensajes se envían a Anthropic para generar respuestas. Cuando utiliza la preparación virtual de espacios o la función Living Listing, las imágenes y los datos relacionados que envía se transmiten a Luma para generar imágenes preparadas o contenido de video.",
          "Los resultados generados por IA, incluidas las imágenes preparadas y el contenido de Living Listing, son ilustrativos y están destinados a ayudar a visualizar posibilidades. Es posible que no reflejen con exactitud la condición, las dimensiones o las características reales de una propiedad y no deben considerarse como una representación fáctica. No envíe a través de las funciones de IA información que no desee que sea procesada para estos fines.",
        ],
      },
      {
        heading: "6. Cookies y Tecnologías Similares",
        body: [
          "Nosotros y nuestros proveedores de servicios usamos cookies y tecnologías similares para operar el Servicio, recordar sus preferencias, mantener su sesión iniciada, comprender cómo se utiliza el Servicio y mejorarlo.",
          "Para una descripción detallada de las cookies y tecnologías similares que usamos y de las opciones disponibles para usted, consulte nuestra Política de Cookies independiente.",
        ],
      },
      {
        heading: "7. Conservación de Datos",
        body: [
          "Conservamos la información personal durante el tiempo que sea necesario para prestar el Servicio, mantener su cuenta, completar y documentar las transacciones inmobiliarias, cumplir con nuestras obligaciones legales y de mantenimiento de registros, resolver disputas y hacer cumplir nuestros acuerdos.",
          "Cuando la información ya no es necesaria para estos fines, tomamos medidas razonables para eliminarla o para anonimizarla o desidentificarla. Los períodos de conservación varían según el tipo de información y el fin para el cual se recopiló.",
        ],
      },
      {
        heading: "8. Seguridad de los Datos",
        body: [
          "Utilizamos medidas administrativas, técnicas y organizativas razonables diseñadas para proteger la información personal contra la pérdida, el uso indebido y el acceso, la divulgación, la alteración y la destrucción no autorizados. Nos apoyamos en proveedores de servicios establecidos y aplicamos controles de acceso y otras salvaguardas apropiadas para la naturaleza de la información.",
          "Sin embargo, ningún método de transmisión por Internet ni método de almacenamiento electrónico es completamente seguro. No podemos garantizar la seguridad absoluta de su información, y usted la proporciona bajo su propio riesgo. Si tiene motivos para creer que su interacción con nosotros ya no es segura, comuníquese con nosotros de inmediato.",
        ],
      },
      {
        heading: "9. Sus Derechos de Privacidad",
        body: [
          "Según el lugar donde resida y conforme a la ley aplicable, usted puede tener derechos sobre su información personal, incluido el derecho a acceder a la información que tenemos sobre usted, a corregir información inexacta, a solicitar su eliminación, a obtener una copia de cierta información en un formato portátil y a oponerse a determinados tratamientos.",
          "Para ejercer sus derechos, comuníquese con nosotros en privacy@lixtara.com. Es posible que necesitemos verificar su identidad antes de atender su solicitud, incluso pidiéndole que confirme información asociada con su cuenta, con el fin de proteger su información contra el acceso no autorizado.",
        ],
        sub: [
          {
            heading: "9.1 Residentes de California",
            body: [
              "Si usted es residente de California, la Ley de Privacidad del Consumidor de California (CCPA), en su versión modificada por la Ley de Derechos de Privacidad de California (CPRA), le otorga ciertos derechos sobre su información personal. Estos incluyen el derecho a saber qué información personal recopilamos, usamos y divulgamos; el derecho a solicitar la eliminación de su información personal; el derecho a corregir información personal inexacta; el derecho a oponerse a la venta o la compartición de información personal; y el derecho a no ser discriminado por ejercer sus derechos.",
              "Como se indicó anteriormente, Lixtara no vende su información personal por dinero y actualmente no comparte información personal para publicidad conductual de contexto cruzado. Para ejercer sus derechos en California, comuníquese con nosotros en privacy@lixtara.com.",
            ],
          },
          {
            heading: "9.2 Residentes de Florida",
            body: [
              "Si usted es residente de Florida, la Carta de Derechos Digitales de Florida (Florida Digital Bill of Rights) puede otorgarle ciertos derechos sobre su información personal, que pueden incluir los derechos a acceder, corregir, eliminar y obtener una copia de su información personal, y a oponerse a determinados tratamientos. Para ejercer estos derechos, comuníquese con nosotros en privacy@lixtara.com.",
            ],
          },
        ],
      },
      {
        heading: "10. Privacidad de los Menores",
        body: [
          "El Servicio está destinado a adultos que tengan al menos 18 años. No está dirigido a menores, y no recopilamos a sabiendas información personal de menores. Si cree que un menor nos ha proporcionado información personal, comuníquese con nosotros en privacy@lixtara.com, y tomaremos las medidas apropiadas para eliminarla.",
        ],
      },
      {
        heading: "11. Usuarios Internacionales y Transferencias de Datos",
        body: [
          "Lixtara tiene su sede en los Estados Unidos, y procesamos y almacenamos la información en los Estados Unidos. Si accede al Servicio desde fuera de los Estados Unidos, usted comprende que su información será transferida y procesada en los Estados Unidos, donde las leyes de protección de datos pueden diferir de las de su jurisdicción.",
          "Si usted se encuentra en una jurisdicción regida por leyes como el Reglamento General de Protección de Datos de la UE (GDPR), tenga en cuenta que, al utilizar el Servicio, usted nos indica que procesemos su información en los Estados Unidos según se describe en esta Política.",
        ],
      },
      {
        heading: "12. No Rastrear (Do Not Track)",
        body: [
          "Algunos navegadores ofrecen una señal de \"No Rastrear\" (\"Do Not Track\"). Dado que no existe un estándar coherente en la industria sobre cómo responder a estas señales, el Servicio actualmente no responde a las señales de No Rastrear. Continuaremos supervisando los avances en esta materia.",
        ],
      },
      {
        heading: "13. Enlaces y Servicios de Terceros",
        body: [
          "El Servicio puede contener enlaces a sitios web, productos o servicios de terceros que no poseemos ni controlamos, y se apoya en proveedores externos según se describe en esta Política. No somos responsables de las prácticas de privacidad de estos terceros. Le recomendamos que revise las políticas de privacidad de cualquier servicio de terceros al que acceda.",
        ],
      },
      {
        heading: "14. Cambios a esta Política",
        body: [
          "Podemos actualizar esta Política de Privacidad de vez en cuando para reflejar cambios en nuestras prácticas, la tecnología, los requisitos legales u otros factores. Cuando realicemos cambios, revisaremos la fecha asociada con esta Política y, cuando corresponda, proporcionaremos un aviso adicional. Su uso continuado del Servicio después de que una actualización entre en vigor constituye su aceptación de la Política revisada.",
        ],
      },
      {
        heading: "15. Contáctenos y Cómo Ejercer sus Derechos",
        body: [
          "Si tiene preguntas sobre esta Política de Privacidad o sobre nuestras prácticas de privacidad, o si desea ejercer sus derechos de privacidad, comuníquese con nosotros:",
          "Por correo electrónico para asuntos de privacidad: privacy@lixtara.com",
          "Por correo electrónico para soporte general: support@lixtara.com",
          "Por correo postal: [LIXTARA LEGAL ENTITY NAME], [MAILING ADDRESS]",
          "Atención: [DATA PROTECTION CONTACT]",
          "Para presentar una solicitud de acceso, corrección, eliminación o de ejercicio de sus derechos, envíe un correo electrónico a privacy@lixtara.com con los detalles de su solicitud. Es posible que necesitemos verificar su identidad antes de procesar su solicitud.",
        ],
      },
    ],
  },
};
