import type { LegalContent } from "./types";
import { publicAgentBlock } from "./dmca-agent";

// DMCA notice-and-takedown policy. Structured to satisfy 17 U.S.C. § 512:
// § 512(c)(2) designated agent · § 512(c)(3)(A) notice elements ·
// § 512(g)(3) counter-notification elements · § 512(i) repeat-infringer policy ·
// § 512(f) misrepresentation warning.
// Also satisfies MIAMI AOR Data License Agreement § VII.B.2 / § VII.C.2, which
// require these disclosures as a condition of the MLS data feed.

// Solo los campos públicos del registro. El contacto administrativo del service
// provider jamás llega aquí — ver publicAgentBlock() y su test.
const agentBlock = publicAgentBlock();

export const dmcaDoc: LegalContent = {
  en: {
    title: "Copyright & DMCA Policy",
    intro: [
      "Lixtara, LLC (\"Lixtara,\" \"we,\" \"us,\" or \"our\") respects the intellectual property rights of others and expects the people who use our platform to do the same. This policy explains how to notify us of material you believe infringes your copyright, what we do when we receive such a notice, and how to respond if your material was removed.",
      "This policy is provided under the Digital Millennium Copyright Act, 17 U.S.C. § 512. It applies to material displayed on lixtara.com, including property listings, photographs, floor plans, videos, and written descriptions.",
    ],
    sections: [
      {
        heading: "1. Designated Copyright Agent",
        body: [
          "Lixtara has designated the following agent to receive notifications of claimed copyright infringement. This agent is registered with the United States Copyright Office.",
          agentBlock.join("\n"),
          "Please direct copyright notices only to the agent above. Notices sent to other addresses, or inquiries that are not copyright notices, may not receive a timely response and may not be effective under the DMCA.",
        ],
      },
      {
        heading: "2. How to Submit a Notice of Claimed Infringement",
        body: [
          "To be effective under 17 U.S.C. § 512(c)(3)(A), your written notice to our Designated Copyright Agent must include substantially all of the following:",
        ],
        bullets: [
          "A physical or electronic signature of a person authorized to act on behalf of the owner of the exclusive right that is allegedly infringed.",
          "Identification of the copyrighted work claimed to have been infringed, or, if multiple works are covered by a single notice, a representative list of those works.",
          "Identification of the material that is claimed to be infringing and information reasonably sufficient to permit us to locate it — for a listing, please include the full URL of the page and identify the specific photograph or text at issue.",
          "Information reasonably sufficient to permit us to contact you, including your mailing address, telephone number, and, if available, an email address.",
          "A statement that you have a good-faith belief that the disputed use is not authorized by the copyright owner, its agent, or the law.",
          "A statement that the information in the notification is accurate, and, under penalty of perjury, that you are the copyright owner or are authorized to act on the owner's behalf.",
        ],
      },
      {
        heading: "3. What Happens After We Receive a Notice",
        body: [
          "When we receive a notice that substantially complies with Section 2, we will act expeditiously to remove or disable access to the material identified. We will make a reasonable effort to notify the person who supplied the material that it has been removed or disabled, and we will provide that person with a copy of the notice.",
          "Where the material at issue is listing content supplied to us through a Multiple Listing Service data feed, we will additionally forward a complete copy of the notice to the originating MLS within twenty-four (24) hours of receipt, as required by our data license agreement, so that the MLS and the listing brokerage can address the matter at the source.",
          "Removing or disabling material in response to a notice is not a determination that infringement occurred. It is the process the DMCA prescribes, and it is available to the person who supplied the material to contest through a counter-notification.",
        ],
      },
      {
        heading: "4. Counter-Notification",
        body: [
          "If your material was removed or disabled and you believe that removal was the result of a mistake or a misidentification, you may send a written counter-notification to our Designated Copyright Agent. To be effective under 17 U.S.C. § 512(g)(3), it must include substantially all of the following:",
        ],
        bullets: [
          "Your physical or electronic signature.",
          "Identification of the material that was removed or to which access was disabled, and the location at which the material appeared before it was removed or disabled.",
          "A statement under penalty of perjury that you have a good-faith belief that the material was removed or disabled as a result of mistake or misidentification.",
          "Your name, mailing address, and telephone number.",
          "A statement that you consent to the jurisdiction of the Federal District Court for the judicial district in which your address is located — or, if your address is outside the United States, for any judicial district in which Lixtara may be found — and that you will accept service of process from the person who submitted the original notice, or from that person's agent.",
        ],
      },
      {
        heading: "5. Restoration of Material",
        body: [
          "If we receive a valid counter-notification, we will forward a copy to the person who submitted the original notice and inform them that we may replace the removed material, or cease disabling access to it, in not less than ten (10) and not more than fourteen (14) business days.",
          "We will restore the material within that period unless our Designated Copyright Agent first receives notice that the original complaining party has filed an action seeking a court order to restrain the allegedly infringing activity.",
        ],
      },
      {
        heading: "6. Repeat Infringers",
        body: [
          "Consistent with 17 U.S.C. § 512(i), Lixtara has adopted and reasonably implements a policy of terminating, in appropriate circumstances, the accounts of users who are repeat infringers.",
          "Depending on the circumstances, we may also remove specific material, suspend a listing, suspend an account pending review, or decline to accept future submissions from a person or entity. We accommodate and do not interfere with standard technical measures used by copyright owners to identify or protect their works.",
        ],
      },
      {
        heading: "7. Misrepresentations Carry Liability",
        body: [
          "Under 17 U.S.C. § 512(f), a person who knowingly materially misrepresents that material is infringing, or that material was removed or disabled by mistake or misidentification, may be liable for damages — including costs and attorneys' fees — incurred by the alleged infringer, by any copyright owner or its licensee, or by Lixtara.",
          "If you are not certain whether the material at issue is protected by copyright or whether the use is infringing, we encourage you to seek advice from an attorney before submitting a notice or a counter-notification.",
        ],
      },
      {
        heading: "8. Listing Content and Third-Party Rights",
        body: [
          "Some material displayed on Lixtara originates from third parties, including sellers who upload their own photographs and, where applicable, listing content licensed to us through a Multiple Listing Service. Sellers who upload material to Lixtara represent that they hold the necessary rights to do so.",
          "MLS listing content remains the property of its respective owners and is licensed to Lixtara for display only. Copyright and attribution notices accompanying that content may not be removed, obscured, or altered.",
          "Nothing in this policy limits any other right or remedy available to Lixtara, to any copyright owner, or to any other party.",
        ],
      },
    ],
  },
  es: {
    title: "Política de Derechos de Autor y DMCA",
    intro: [
      "Lixtara, LLC (\"Lixtara\", \"nosotros\") respeta los derechos de propiedad intelectual de terceros y espera lo mismo de quienes usan nuestra plataforma. Esta política explica cómo notificarnos sobre material que usted considere que infringe sus derechos de autor, qué hacemos al recibir una notificación, y cómo responder si su material fue retirado.",
      "Esta política se ofrece conforme a la Digital Millennium Copyright Act, 17 U.S.C. § 512. Aplica al material publicado en lixtara.com, incluidas fichas de propiedades, fotografías, planos, videos y descripciones.",
    ],
    sections: [
      {
        heading: "1. Agente Designado de Derechos de Autor",
        body: [
          "Lixtara ha designado al siguiente agente para recibir notificaciones de presunta infracción de derechos de autor. Este agente está registrado ante la Oficina de Derechos de Autor de los Estados Unidos.",
          agentBlock.join("\n"),
          "Dirija las notificaciones de derechos de autor únicamente al agente indicado. Las notificaciones enviadas a otras direcciones, o las consultas que no sean notificaciones de derechos de autor, pueden no recibir respuesta oportuna y pueden no ser efectivas bajo la DMCA.",
        ],
      },
      {
        heading: "2. Cómo Enviar una Notificación de Presunta Infracción",
        body: [
          "Para ser efectiva conforme al 17 U.S.C. § 512(c)(3)(A), su notificación escrita a nuestro Agente Designado debe incluir sustancialmente todo lo siguiente:",
        ],
        bullets: [
          "La firma física o electrónica de una persona autorizada para actuar en nombre del titular del derecho exclusivo presuntamente infringido.",
          "La identificación de la obra protegida que se alega infringida o, si una sola notificación cubre varias obras, una lista representativa de ellas.",
          "La identificación del material que se alega infractor e información razonablemente suficiente para permitirnos localizarlo — tratándose de una ficha de propiedad, incluya la URL completa de la página e identifique la fotografía o el texto específico en cuestión.",
          "Información razonablemente suficiente para contactarlo, incluidos su dirección postal, número de teléfono y, de estar disponible, una dirección de correo electrónico.",
          "Una declaración de que usted tiene la creencia de buena fe de que el uso en disputa no está autorizado por el titular de los derechos, su agente o la ley.",
          "Una declaración de que la información de la notificación es exacta y, bajo pena de perjurio, de que usted es el titular de los derechos o está autorizado para actuar en su nombre.",
        ],
      },
      {
        heading: "3. Qué Ocurre Tras Recibir una Notificación",
        body: [
          "Al recibir una notificación que cumpla sustancialmente con la Sección 2, actuaremos con diligencia para retirar el material identificado o deshabilitar el acceso a él. Haremos un esfuerzo razonable por informar a quien aportó el material que este fue retirado o deshabilitado, y le entregaremos una copia de la notificación.",
          "Cuando el material en cuestión sea contenido de fichas que recibimos mediante un feed de datos de un Multiple Listing Service, además reenviaremos una copia completa de la notificación al MLS de origen dentro de las veinticuatro (24) horas siguientes a su recepción, según lo exige nuestro acuerdo de licencia de datos, para que el MLS y la correduría listadora atiendan el asunto en la fuente.",
          "Retirar o deshabilitar material en respuesta a una notificación no constituye una determinación de que hubo infracción. Es el procedimiento que prescribe la DMCA, y quien aportó el material puede impugnarlo mediante una contranotificación.",
        ],
      },
      {
        heading: "4. Contranotificación",
        body: [
          "Si su material fue retirado o deshabilitado y usted considera que ello se debió a un error o a una identificación equivocada, puede enviar una contranotificación escrita a nuestro Agente Designado. Para ser efectiva conforme al 17 U.S.C. § 512(g)(3), debe incluir sustancialmente todo lo siguiente:",
        ],
        bullets: [
          "Su firma física o electrónica.",
          "La identificación del material retirado o cuyo acceso fue deshabilitado, y la ubicación en la que aparecía antes de ser retirado o deshabilitado.",
          "Una declaración, bajo pena de perjurio, de que usted tiene la creencia de buena fe de que el material fue retirado o deshabilitado como resultado de un error o de una identificación equivocada.",
          "Su nombre, dirección postal y número de teléfono.",
          "Una declaración de que usted acepta la jurisdicción del Tribunal Federal de Distrito del distrito judicial donde se ubica su dirección — o, si su dirección está fuera de los Estados Unidos, de cualquier distrito judicial donde Lixtara pueda ser hallada — y de que aceptará la notificación de actuaciones judiciales de parte de quien presentó la notificación original o de su agente.",
        ],
      },
      {
        heading: "5. Restitución del Material",
        body: [
          "Si recibimos una contranotificación válida, enviaremos una copia a quien presentó la notificación original y le informaremos que podremos reponer el material retirado, o dejar de deshabilitar su acceso, en no menos de diez (10) ni más de catorce (14) días hábiles.",
          "Repondremos el material dentro de ese plazo salvo que nuestro Agente Designado reciba antes aviso de que la parte reclamante original inició una acción judicial para obtener una orden que impida la actividad presuntamente infractora.",
        ],
      },
      {
        heading: "6. Infractores Reincidentes",
        body: [
          "Conforme al 17 U.S.C. § 512(i), Lixtara ha adoptado e implementa razonablemente una política de terminación, en las circunstancias apropiadas, de las cuentas de usuarios que sean infractores reincidentes.",
          "Según las circunstancias, también podremos retirar material específico, suspender una publicación, suspender una cuenta mientras se revisa el caso, o negarnos a aceptar envíos futuros de una persona o entidad. Acomodamos y no interferimos con las medidas técnicas estándar que los titulares de derechos utilizan para identificar o proteger sus obras.",
        ],
      },
      {
        heading: "7. Las Declaraciones Falsas Generan Responsabilidad",
        body: [
          "Conforme al 17 U.S.C. § 512(f), quien a sabiendas tergiverse de forma sustancial que un material es infractor, o que un material fue retirado o deshabilitado por error o identificación equivocada, puede responder por los daños — incluidos costos y honorarios de abogados — que sufran el presunto infractor, cualquier titular de derechos o su licenciatario, o Lixtara.",
          "Si no tiene certeza de si el material en cuestión está protegido por derechos de autor o de si el uso es infractor, le recomendamos consultar a un abogado antes de enviar una notificación o una contranotificación.",
        ],
      },
      {
        heading: "8. Contenido de Fichas y Derechos de Terceros",
        body: [
          "Parte del material publicado en Lixtara proviene de terceros, incluidos vendedores que cargan sus propias fotografías y, cuando corresponda, contenido de fichas que se nos licencia a través de un Multiple Listing Service. Los vendedores que cargan material en Lixtara declaran contar con los derechos necesarios para hacerlo.",
          "El contenido de fichas del MLS sigue siendo propiedad de sus respectivos titulares y se licencia a Lixtara únicamente para su visualización. Los avisos de derechos de autor y de atribución que acompañan ese contenido no pueden ser retirados, ocultados ni alterados.",
          "Nada en esta política limita cualquier otro derecho o recurso disponible para Lixtara, para cualquier titular de derechos de autor, o para cualquier otra parte.",
        ],
      },
    ],
  },
};
