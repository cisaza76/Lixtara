import type { LegalContent } from "./types";

// Declaración de accesibilidad v2 (2026-10-18), publicada por decisión del owner sin revisión
// del abogado todavía: docs/legal/2026-10-18-textos-v2-memo.md. Marcadores:
// src/lib/legal/config.ts. Declaración de objetivo, no de cumplimiento: no afirma conformidad
// con WCAG ni promete plazos de respuesta ni canales que no existen.
export const accessibilityDoc: LegalContent = {
  en: {
    title: "Accessibility Statement",
    intro: [
      "{legalName} wants everyone, including people with disabilities, to be able to find a home, list a property and use lixtara.com. This statement explains our goal, what we have done, the limits we know about and how to tell us about a barrier.",
    ],
    sections: [
      {
        id: "goal",
        heading: "1. Our Goal",
        body: [
          "We use the Web Content Accessibility Guidelines (WCAG) 2.1, Level AA, published by the World Wide Web Consortium, as the target for the design and development of lixtara.com, in English and in Spanish. Accessibility is ongoing work: we have not certified that every page meets that standard, and some parts of the site may not yet do so.",
        ],
      },
      {
        id: "measures",
        heading: "2. What We Work Toward",
        body: ["In designing and building the site, we aim to:"],
        bullets: [
          "use semantic HTML, headings and labeled form fields, so pages work with screen readers;",
          "support keyboard use, with visible focus indicators;",
          "use text and background colors with sufficient contrast, without conveying information by color alone;",
          "show form errors next to the field, in the language of the page;",
          "provide text alternatives for meaningful images.",
        ],
      },
      {
        id: "limitations",
        heading: "3. Known Limitations",
        body: [
          "Some content comes from third parties and is outside our full control, including listing photos and data from the multiple listing service, electronic signature (DocuSign), payment pages (Stripe), maps and address suggestions (Google Maps) and documents in PDF format. If one of these prevents you from completing a task, contact us and we will work with you to find another way.",
        ],
      },
      {
        id: "report",
        heading: "4. Report a Barrier or Ask for Help",
        body: [
          "If you have difficulty using any part of lixtara.com, or need information in an alternative format, tell us the page address and the problem you found:",
        ],
        bullets: [
          "Email: {supportEmail}",
          "Mail: {legalName}, {brokerageAddress}",
        ],
        sub: [
          {
            heading: "4.1 Our response",
            body: [
              "We will reply by email and work with you to provide the information, or complete the task you need, another way.",
            ],
          },
        ],
      },
      {
        id: "updates",
        heading: "5. Updates to This Statement",
        body: [
          "We may update this statement. The date of the last update is shown at the top of this page.",
        ],
      },
    ],
  },
  es: {
    title: "Declaración de Accesibilidad",
    intro: [
      "{legalName} quiere que todas las personas, incluidas las personas con discapacidad, puedan buscar vivienda, publicar una propiedad y usar lixtara.com. En esta declaración explicamos nuestro objetivo, lo que hemos hecho, los límites que conocemos y cómo informarnos de una barrera.",
    ],
    sections: [
      {
        id: "goal",
        heading: "1. Nuestro Objetivo",
        body: [
          "Tomamos como meta para el diseño y el desarrollo de lixtara.com, en inglés y en español, las Pautas de Accesibilidad para el Contenido Web (WCAG) 2.1, nivel AA, del World Wide Web Consortium. La accesibilidad es un trabajo continuo: no hemos certificado que todas las páginas cumplan esa norma, y es posible que algunas partes del sitio todavía no lo hagan.",
        ],
      },
      {
        id: "measures",
        heading: "2. Lo Que Procuramos",
        body: ["Al diseñar y construir el sitio, procuramos:"],
        bullets: [
          "usar HTML semántico, encabezados y campos de formulario con etiquetas, para que las páginas funcionen con lectores de pantalla;",
          "permitir el uso con teclado, con indicadores de foco visibles;",
          "usar colores de texto y fondo con contraste suficiente, sin transmitir información solo mediante el color;",
          "mostrar los errores de los formularios junto al campo, en el idioma de la página;",
          "ofrecer textos alternativos para las imágenes con contenido.",
        ],
      },
      {
        id: "limitations",
        heading: "3. Limitaciones Conocidas",
        body: [
          "Parte del contenido proviene de terceros y no está completamente bajo nuestro control, como las fotos y los datos de los listados del servicio de listados múltiples, la firma electrónica (DocuSign), las páginas de pago (Stripe), los mapas y las sugerencias de direcciones (Google Maps) y los documentos en formato PDF. Si alguno de ellos le impide completar una gestión, escríbanos y buscaremos con usted otra vía.",
        ],
      },
      {
        id: "report",
        heading: "4. Informe una Barrera o Pida Ayuda",
        body: [
          "Si tiene dificultades para usar alguna parte de lixtara.com, o necesita información en un formato alternativo, indíquenos la dirección de la página y el problema que encontró:",
        ],
        bullets: [
          "Correo electrónico: {supportEmail}",
          "Correo postal: {legalName}, {brokerageAddress}",
        ],
        sub: [
          {
            heading: "4.1 Nuestra respuesta",
            body: [
              "Le responderemos por correo electrónico y trabajaremos con usted para darle la información, o completar la gestión que necesita, por otra vía.",
            ],
          },
        ],
      },
      {
        id: "updates",
        heading: "5. Actualizaciones de Esta Declaración",
        body: [
          "Podemos actualizar esta declaración. La fecha de la última actualización aparece al principio de esta página.",
        ],
      },
    ],
  },
};
