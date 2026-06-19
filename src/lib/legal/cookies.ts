import type { LegalContent } from "./types";

export const cookiesDoc: LegalContent = {
  en: {
    title: "Cookie Policy",
    intro: [
      "This Cookie Policy explains how Lixtara (\"Lixtara,\" \"we,\" \"us,\" or \"our\"), a real-estate platform based in Miami, Florida, uses cookies and similar technologies when you visit our website and use our services.",
      "It describes what these technologies are, why we use them, the categories of cookies we rely on, and the choices available to you. This policy should be read together with our Privacy Policy, which explains how we handle personal information more generally.",
      "By using Lixtara, you agree to the use of strictly necessary cookies, which are essential for the platform to function. Any future use of non-essential cookies will be subject to the consent process described in this policy. This policy is governed by the laws of the State of Florida, USA, and applicable privacy and ePrivacy laws.",
    ],
    sections: [
      {
        heading: "1. What Are Cookies (and Similar Technologies)",
        body: [
          "Cookies are small text files that a website places on your device (computer, tablet, or phone) when you visit. They allow the website to recognize your device, remember certain information about your visit, and function reliably across pages and sessions.",
          "\"Similar technologies\" refers to other mechanisms that store or read information on your device for comparable purposes. The most common example we use is browser local storage and session storage, which let the platform keep limited information (such as your interface preferences or sign-in state) in your browser.",
          "In this policy, references to \"cookies\" include these similar technologies unless we state otherwise.",
        ],
        bullets: [
          "First-party cookies are set by Lixtara itself.",
          "Third-party cookies are set by external services we embed (for example, payment or e-signature tools) and are governed by those providers' own policies.",
          "Session cookies are temporary and are deleted when you close your browser.",
          "Persistent cookies remain on your device for a set period or until you delete them.",
        ],
      },
      {
        heading: "2. How We Use Cookies",
        body: [
          "Today, Lixtara primarily uses strictly necessary cookies. These keep you securely signed in, protect the listing and transaction flows, and remember basic preferences such as your chosen language.",
          "We use cookies to operate and secure the platform, not to track you across unrelated websites for advertising. We do not currently use cookies for advertising, and we do not currently run product or marketing analytics that rely on cookies.",
        ],
        bullets: [
          "To authenticate sellers and buyers and keep them signed in.",
          "To secure the listing flow and other account actions against misuse.",
          "To remember preferences such as your language selection.",
          "To support rate-limiting and security measures that help protect the platform.",
        ],
      },
      {
        heading: "3. Types of Cookies We Use",
        body: [
          "The cookies and similar technologies on Lixtara fall into the categories described below. Because we focus on essential functionality, most of what we use is strictly necessary or functional.",
        ],
        sub: [
          {
            heading: "3.1 Strictly Necessary — Authentication & Session",
            body: [
              "These cookies are essential for the platform to work. They are set by our authentication provider (Supabase Auth) to keep sellers and buyers signed in, maintain a secure session, and protect the listing and transaction flows.",
              "Without these cookies, you would not be able to sign in or complete core actions such as creating or managing a listing.",
            ],
            bullets: [
              "Maintain your signed-in session as you move between pages.",
              "Help secure account and listing actions.",
              "Cannot be switched off through our platform because the service cannot function without them.",
            ],
          },
          {
            heading: "3.2 Functional / Preference",
            body: [
              "These cookies and storage entries remember choices you make so the platform behaves the way you expect.",
            ],
            bullets: [
              "Remember your language preference (for example, English or Spanish).",
              "Remember basic interface preferences.",
              "If disabled, the platform still works, but some preferences may not be retained between visits.",
            ],
          },
          {
            heading: "3.3 Security & Rate-Limiting",
            body: [
              "These technologies support measures that help protect the platform from abuse, including rate-limiting mechanisms (for example, those powered by Upstash) that limit how often certain actions can be performed.",
            ],
            bullets: [
              "Help detect and limit abusive or automated activity.",
              "Support the integrity and availability of the service.",
            ],
          },
          {
            heading: "3.4 Analytics & Performance",
            body: [
              "We do not currently use analytics or performance cookies. If, in the future, we add privacy-respecting product or marketing analytics, this policy will be updated and, where required by applicable law, we will obtain your consent before such non-essential cookies are set.",
            ],
            bullets: [
              "Not currently in use.",
              "Any future use will be disclosed here and, where required, consent-based.",
            ],
          },
          {
            heading: "3.5 Advertising",
            body: [
              "We do not use advertising or targeting cookies. Lixtara does not serve third-party advertising and does not use cookies to build advertising profiles or track you across unrelated websites.",
            ],
            bullets: [
              "Not used.",
            ],
          },
        ],
      },
      {
        heading: "4. Third-Party Cookies",
        body: [
          "When you use certain features, we embed third-party tools that may set their own cookies on your device. These cookies are controlled by those providers, not by Lixtara, and are governed by the providers' own cookie and privacy policies. We encourage you to review those policies.",
          "These third-party cookies are generally only relevant when you actually use the corresponding feature.",
        ],
        bullets: [
          "Stripe — when you complete a payment or checkout.",
          "DocuSign — when you review or sign documents electronically.",
          "Mapbox and Google Maps — when maps are displayed or used.",
        ],
      },
      {
        heading: "5. How Long Cookies Last",
        body: [
          "Cookies last for different lengths of time depending on their purpose.",
          "Session cookies are temporary. They exist only for the duration of your visit and are removed when you close your browser. Persistent cookies remain on your device for a defined period or until you delete them, allowing the platform to remember information across visits, such as keeping you signed in or remembering your language.",
          "The exact lifespan of third-party cookies is determined by the providers that set them.",
        ],
        bullets: [
          "Session cookies — deleted when you close your browser.",
          "Persistent cookies — remain for a set period or until you clear them.",
        ],
      },
      {
        heading: "6. Managing & Disabling Cookies",
        body: [
          "You can control and delete cookies through your browser settings. Most browsers let you view the cookies stored on your device, block or delete them, and choose whether to accept cookies from specific sites. The steps vary by browser, so check your browser's help resources for details.",
          "Please note that strictly necessary cookies are essential to how Lixtara works. If you block or delete them, you will not be able to sign in, and the listing flow and other core features will not function correctly.",
          "Disabling functional cookies will not break the platform but may mean preferences such as your language are not remembered between visits.",
        ],
        bullets: [
          "Use your browser settings to view, block, or delete cookies.",
          "Clearing cookies may sign you out and reset your preferences.",
          "Blocking strictly necessary cookies will prevent sign-in and the listing flow from working.",
        ],
      },
      {
        heading: "7. Consent & the Cookie Notice",
        body: [
          "When you first visit Lixtara, we show a lightweight cookie notice that informs you about our use of cookies and points you to this policy.",
          "Strictly necessary cookies do not require your consent because the platform cannot function without them. If we introduce non-essential cookies in the future (for example, analytics), we will request your consent where required by applicable privacy and ePrivacy laws before those cookies are set, and you will be able to make a choice through the cookie notice.",
        ],
        bullets: [
          "Strictly necessary cookies are used without separate consent.",
          "Any future non-essential cookies will be subject to consent where required.",
        ],
      },
      {
        heading: "8. Changes to This Cookie Policy",
        body: [
          "We may update this Cookie Policy from time to time to reflect changes in the technologies we use, in our services, or in legal requirements. When we make material changes, we will update the effective date shown with this policy and, where appropriate, provide additional notice.",
          "We encourage you to review this policy periodically to stay informed about how we use cookies.",
        ],
      },
      {
        heading: "9. Contact Us",
        body: [
          "If you have questions about this Cookie Policy or our use of cookies, please contact us.",
        ],
        bullets: [
          "Email: privacy@lixtara.com",
          "Lixtara, Miami, Florida, USA",
          "Mailing address: [MAILING ADDRESS]",
        ],
      },
    ],
  },
  es: {
    title: "Política de Cookies",
    intro: [
      "Esta Política de Cookies explica cómo Lixtara (\"Lixtara\", \"nosotros\" o \"nuestro\"), una plataforma inmobiliaria con sede en Miami, Florida, utiliza cookies y tecnologías similares cuando visita nuestro sitio web y utiliza nuestros servicios.",
      "Describe qué son estas tecnologías, por qué las utilizamos, las categorías de cookies de las que dependemos y las opciones disponibles para usted. Esta política debe leerse junto con nuestra Política de Privacidad, que explica de forma más general cómo tratamos la información personal.",
      "Al utilizar Lixtara, usted acepta el uso de cookies estrictamente necesarias, que son esenciales para que la plataforma funcione. Cualquier uso futuro de cookies no esenciales estará sujeto al proceso de consentimiento descrito en esta política. Esta política se rige por las leyes del Estado de Florida, EE. UU., y por las leyes aplicables de privacidad y de privacidad en las comunicaciones electrónicas (ePrivacy).",
    ],
    sections: [
      {
        heading: "1. Qué Son las Cookies (y Tecnologías Similares)",
        body: [
          "Las cookies son pequeños archivos de texto que un sitio web coloca en su dispositivo (computadora, tableta o teléfono) cuando lo visita. Permiten que el sitio web reconozca su dispositivo, recuerde cierta información sobre su visita y funcione de forma fiable entre páginas y sesiones.",
          "Las \"tecnologías similares\" se refieren a otros mecanismos que almacenan o leen información en su dispositivo con fines comparables. El ejemplo más común que utilizamos es el almacenamiento local (local storage) y de sesión (session storage) del navegador, que permiten a la plataforma conservar información limitada (como sus preferencias de interfaz o su estado de inicio de sesión) en su navegador.",
          "En esta política, las referencias a \"cookies\" incluyen estas tecnologías similares, salvo que se indique lo contrario.",
        ],
        bullets: [
          "Las cookies de origen propio son establecidas por la propia Lixtara.",
          "Las cookies de terceros son establecidas por servicios externos que integramos (por ejemplo, herramientas de pago o de firma electrónica) y se rigen por las políticas propias de esos proveedores.",
          "Las cookies de sesión son temporales y se eliminan cuando cierra su navegador.",
          "Las cookies persistentes permanecen en su dispositivo durante un período determinado o hasta que las elimine.",
        ],
      },
      {
        heading: "2. Cómo Utilizamos las Cookies",
        body: [
          "Hoy, Lixtara utiliza principalmente cookies estrictamente necesarias. Estas mantienen su sesión iniciada de forma segura, protegen los flujos de publicación de propiedades y de transacciones, y recuerdan preferencias básicas como el idioma que ha elegido.",
          "Utilizamos cookies para operar y proteger la plataforma, no para rastrearle a través de sitios web no relacionados con fines publicitarios. Actualmente no utilizamos cookies con fines publicitarios y no ejecutamos análisis de producto ni de marketing que dependan de cookies.",
        ],
        bullets: [
          "Para autenticar a vendedores y compradores y mantener su sesión iniciada.",
          "Para proteger el flujo de publicación y otras acciones de la cuenta contra usos indebidos.",
          "Para recordar preferencias como la selección de idioma.",
          "Para respaldar las medidas de limitación de frecuencia (rate-limiting) y de seguridad que ayudan a proteger la plataforma.",
        ],
      },
      {
        heading: "3. Tipos de Cookies que Utilizamos",
        body: [
          "Las cookies y tecnologías similares en Lixtara se agrupan en las categorías descritas a continuación. Dado que nos centramos en la funcionalidad esencial, la mayor parte de lo que utilizamos es estrictamente necesario o funcional.",
        ],
        sub: [
          {
            heading: "3.1 Estrictamente Necesarias — Autenticación y Sesión",
            body: [
              "Estas cookies son esenciales para que la plataforma funcione. Las establece nuestro proveedor de autenticación (Supabase Auth) para mantener a vendedores y compradores con la sesión iniciada, conservar una sesión segura y proteger los flujos de publicación y de transacciones.",
              "Sin estas cookies, no podría iniciar sesión ni completar acciones esenciales como crear o gestionar una publicación.",
            ],
            bullets: [
              "Mantienen su sesión iniciada mientras navega entre páginas.",
              "Ayudan a proteger las acciones de cuenta y de publicación.",
              "No pueden desactivarse a través de nuestra plataforma, ya que el servicio no puede funcionar sin ellas.",
            ],
          },
          {
            heading: "3.2 Funcionales / de Preferencia",
            body: [
              "Estas cookies y entradas de almacenamiento recuerdan las elecciones que usted realiza para que la plataforma se comporte como espera.",
            ],
            bullets: [
              "Recuerdan su preferencia de idioma (por ejemplo, inglés o español).",
              "Recuerdan preferencias básicas de la interfaz.",
              "Si se desactivan, la plataforma sigue funcionando, pero es posible que algunas preferencias no se conserven entre visitas.",
            ],
          },
          {
            heading: "3.3 Seguridad y Limitación de Frecuencia",
            body: [
              "Estas tecnologías respaldan medidas que ayudan a proteger la plataforma frente a abusos, incluidos los mecanismos de limitación de frecuencia (por ejemplo, los impulsados por Upstash) que limitan la frecuencia con la que pueden realizarse ciertas acciones.",
            ],
            bullets: [
              "Ayudan a detectar y limitar la actividad abusiva o automatizada.",
              "Respaldan la integridad y la disponibilidad del servicio.",
            ],
          },
          {
            heading: "3.4 Análisis y Rendimiento",
            body: [
              "Actualmente no utilizamos cookies de análisis ni de rendimiento. Si, en el futuro, incorporamos análisis de producto o de marketing que respeten la privacidad, esta política se actualizará y, cuando lo exija la ley aplicable, obtendremos su consentimiento antes de que se establezcan dichas cookies no esenciales.",
            ],
            bullets: [
              "No se utilizan actualmente.",
              "Cualquier uso futuro se divulgará aquí y, cuando se requiera, se basará en el consentimiento.",
            ],
          },
          {
            heading: "3.5 Publicidad",
            body: [
              "No utilizamos cookies de publicidad ni de segmentación. Lixtara no muestra publicidad de terceros y no utiliza cookies para crear perfiles publicitarios ni para rastrearle a través de sitios web no relacionados.",
            ],
            bullets: [
              "No se utilizan.",
            ],
          },
        ],
      },
      {
        heading: "4. Cookies de Terceros",
        body: [
          "Cuando utiliza determinadas funciones, integramos herramientas de terceros que pueden establecer sus propias cookies en su dispositivo. Estas cookies son controladas por dichos proveedores, no por Lixtara, y se rigen por las políticas de cookies y de privacidad propias de los proveedores. Le recomendamos revisar dichas políticas.",
          "Estas cookies de terceros suelen ser relevantes únicamente cuando usted utiliza efectivamente la función correspondiente.",
        ],
        bullets: [
          "Stripe — cuando realiza un pago o un proceso de pago (checkout).",
          "DocuSign — cuando revisa o firma documentos electrónicamente.",
          "Mapbox y Google Maps — cuando se muestran o utilizan mapas.",
        ],
      },
      {
        heading: "5. Cuánto Duran las Cookies",
        body: [
          "Las cookies duran períodos de tiempo distintos según su finalidad.",
          "Las cookies de sesión son temporales. Existen únicamente durante su visita y se eliminan cuando cierra su navegador. Las cookies persistentes permanecen en su dispositivo durante un período definido o hasta que las elimine, lo que permite a la plataforma recordar información entre visitas, como mantener su sesión iniciada o recordar su idioma.",
          "La duración exacta de las cookies de terceros la determinan los proveedores que las establecen.",
        ],
        bullets: [
          "Cookies de sesión — se eliminan cuando cierra su navegador.",
          "Cookies persistentes — permanecen durante un período determinado o hasta que las borre.",
        ],
      },
      {
        heading: "6. Gestión y Desactivación de Cookies",
        body: [
          "Puede controlar y eliminar las cookies a través de la configuración de su navegador. La mayoría de los navegadores le permiten ver las cookies almacenadas en su dispositivo, bloquearlas o eliminarlas, y elegir si acepta cookies de sitios específicos. Los pasos varían según el navegador, por lo que le recomendamos consultar los recursos de ayuda de su navegador para más detalles.",
          "Tenga en cuenta que las cookies estrictamente necesarias son esenciales para el funcionamiento de Lixtara. Si las bloquea o elimina, no podrá iniciar sesión, y el flujo de publicación y otras funciones esenciales no funcionarán correctamente.",
          "Desactivar las cookies funcionales no inutilizará la plataforma, pero puede implicar que preferencias como su idioma no se recuerden entre visitas.",
        ],
        bullets: [
          "Utilice la configuración de su navegador para ver, bloquear o eliminar cookies.",
          "Borrar las cookies puede cerrar su sesión y restablecer sus preferencias.",
          "Bloquear las cookies estrictamente necesarias impedirá el inicio de sesión y el funcionamiento del flujo de publicación.",
        ],
      },
      {
        heading: "7. Consentimiento y el Aviso de Cookies",
        body: [
          "Cuando visita Lixtara por primera vez, le mostramos un aviso de cookies ligero que le informa sobre nuestro uso de cookies y le remite a esta política.",
          "Las cookies estrictamente necesarias no requieren su consentimiento porque la plataforma no puede funcionar sin ellas. Si en el futuro incorporamos cookies no esenciales (por ejemplo, de análisis), solicitaremos su consentimiento cuando lo exijan las leyes aplicables de privacidad y de privacidad en las comunicaciones electrónicas (ePrivacy) antes de establecer dichas cookies, y podrá realizar su elección a través del aviso de cookies.",
        ],
        bullets: [
          "Las cookies estrictamente necesarias se utilizan sin un consentimiento por separado.",
          "Cualquier cookie no esencial futura estará sujeta a consentimiento cuando se requiera.",
        ],
      },
      {
        heading: "8. Cambios en Esta Política de Cookies",
        body: [
          "Podemos actualizar esta Política de Cookies de vez en cuando para reflejar cambios en las tecnologías que utilizamos, en nuestros servicios o en los requisitos legales. Cuando realicemos cambios sustanciales, actualizaremos la fecha de vigencia que se muestra junto a esta política y, cuando corresponda, proporcionaremos un aviso adicional.",
          "Le recomendamos revisar esta política periódicamente para mantenerse informado sobre cómo utilizamos las cookies.",
        ],
      },
      {
        heading: "9. Contáctenos",
        body: [
          "Si tiene preguntas sobre esta Política de Cookies o sobre nuestro uso de cookies, contáctenos.",
        ],
        bullets: [
          "Correo electrónico: privacy@lixtara.com",
          "Lixtara, Miami, Florida, EE. UU.",
          "Dirección postal: [MAILING ADDRESS]",
        ],
      },
    ],
  },
};
