import type { LegalContent } from "./types";

// BORRADOR 2026-10 para revisión del abogado de Lixtara. Marcadores: src/lib/legal/config.ts.
// Declaración de compromiso, no de cumplimiento: no afirma conformidad total con WCAG.
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
        heading: "2. What We Do",
        body: [],
        bullets: [
          "We build pages with semantic HTML, headings and labeled form fields, so they work with screen readers.",
          "We design for keyboard use, with visible focus indicators.",
          "We choose text and background colors with sufficient contrast and avoid conveying information by color alone.",
          "Form errors are shown next to the field, in the language of the page, and focus moves to the first field that needs attention.",
          "We provide text alternatives for meaningful images and review accessibility when we release new features.",
        ],
      },
      {
        id: "limitations",
        heading: "3. Known Limitations",
        body: [
          "Some content comes from third parties and is outside our full control, including listing photos and data from the multiple listing service, electronic signature (DocuSign), payment pages (Stripe), maps and address suggestions (Google Maps) and documents in PDF format. If one of these prevents you from completing a task, contact us and we will help you complete it another way.",
        ],
      },
      {
        id: "report",
        heading: "4. Report a Barrier or Ask for Help",
        body: [
          "If you have difficulty using any part of lixtara.com, or need information in an alternative format, tell us the page address and the problem you found:",
        ],
        bullets: [
          "Email: {accessibilityEmail} or {supportEmail}",
          "Mail: {legalName}, {brokerageAddress}",
        ],
        sub: [
          {
            heading: "4.1 Our response",
            body: [
              "We will acknowledge your message and try to respond within [VERIFICAR: plazo de respuesta, p. ej. 2 días hábiles], and we will work with you to provide the information or complete the service you need through another channel, such as email or a phone call with our team. [VERIFICAR: canales alternativos que de verdad se ofrecerán (teléfono, asistencia por correo, cita con la broker).]",
            ],
          },
        ],
      },
      {
        id: "review",
        heading: "5. Review of This Statement",
        body: [
          "We review this statement when we make significant changes to the site and at least once a year. The date of the last review is shown at the top of this page.",
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
        heading: "2. Lo Que Hacemos",
        body: [],
        bullets: [
          "Construimos las páginas con HTML semántico, encabezados y campos de formulario con etiquetas, para que funcionen con lectores de pantalla.",
          "Diseñamos para el uso con teclado, con indicadores de foco visibles.",
          "Elegimos colores de texto y fondo con contraste suficiente y no transmitimos información solo mediante el color.",
          "Los errores de los formularios aparecen junto al campo, en el idioma de la página, y el foco pasa al primer campo que requiere atención.",
          "Ofrecemos textos alternativos para las imágenes con contenido y revisamos la accesibilidad cuando publicamos funciones nuevas.",
        ],
      },
      {
        id: "limitations",
        heading: "3. Limitaciones Conocidas",
        body: [
          "Parte del contenido proviene de terceros y no está completamente bajo nuestro control, como las fotos y los datos de los listados del servicio de listados múltiples, la firma electrónica (DocuSign), las páginas de pago (Stripe), los mapas y las sugerencias de direcciones (Google Maps) y los documentos en formato PDF. Si alguno de ellos le impide completar una gestión, escríbanos y le ayudaremos a completarla por otra vía.",
        ],
      },
      {
        id: "report",
        heading: "4. Informe una Barrera o Pida Ayuda",
        body: [
          "Si tiene dificultades para usar alguna parte de lixtara.com, o necesita información en un formato alternativo, indíquenos la dirección de la página y el problema que encontró:",
        ],
        bullets: [
          "Correo electrónico: {accessibilityEmail} o {supportEmail}",
          "Correo postal: {legalName}, {brokerageAddress}",
        ],
        sub: [
          {
            heading: "4.1 Nuestra respuesta",
            body: [
              "Confirmaremos la recepción de su mensaje e intentaremos responder dentro de [VERIFICAR: plazo de respuesta, p. ej. 2 días hábiles], y trabajaremos con usted para darle la información o completar el servicio que necesita por otro canal, como el correo electrónico o una llamada con nuestro equipo. [VERIFICAR: canales alternativos que de verdad se ofrecerán (teléfono, asistencia por correo, cita con la broker).]",
            ],
          },
        ],
      },
      {
        id: "review",
        heading: "5. Revisión de Esta Declaración",
        body: [
          "Revisamos esta declaración cuando hacemos cambios importantes en el sitio y al menos una vez al año. La fecha de la última revisión aparece al principio de esta página.",
        ],
      },
    ],
  },
};
