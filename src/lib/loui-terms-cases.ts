// Casos de prueba de Ask Loui para la compensación al agente del comprador (0% y monto fijo),
// el plazo de publicación, el reembolso y las funciones del catálogo MLS que no están activas (EN/ES). Los corre, junto con loui-legal-cases.ts, la
// evaluación contra el modelo real: `pnpm exec tsx --env-file=.env.local scripts/loui-legal-evals.ts`.

import type { LouiLegalCase } from "@/lib/loui-legal-cases";

const USTED = /\busted\b/i;
/** Dice que la compensación se publica en el MLS, en una línea sin ninguna negación. */
const SAYS_ON_MLS_EN = /^(?![^\n]*(\bnot\b|n't\b|\bnever\b|\bno longer\b))[^\n]*\b(published|posted|shown|listed) (on|in) the MLS/im;
const SAYS_ON_MLS_ES = /^(?![^\n]*\b(no|nunca|ya no)\b)[^\n]*(se publica|aparece|se muestra) en el MLS/im;
/** Términos del glosario en español (src/config/glossary.ts). */
const NOT_GLOSSARY_ES = /\bflat fee\b|\bcorredor(a)?\b(?! hipotecari)|honorarios de Lixtara|comisi[oó]n del comprador/i;
const OTHER_TIMING_EN = /\b(24|48|72) ?(h|hours)\b|within (a|one) (business )?day/i;
/** Ofrece alertas, búsquedas guardadas o avisos de propiedades nuevas (sin negación en la línea). */
const OFFERS_ALERTS_EN = /^(?![^\n]*(\bnot\b|n't\b|\bno\b|\bnever\b))[^\n]*\b(search alerts?|saved searche?s?|listing alerts?|alerts? for new|notif(y|ied|ications?)[^\n]*(new|listings?|homes?))/im;
const OFFERS_ALERTS_ES = /^(?![^\n]*\b(no|nunca)\b)[^\n]*\b(alertas?|b[uú]squedas? guardadas?|te avisamos|te avisaremos|notificaciones?)\b/im;
const OTHER_TIMING_ES = /\b(24|48|72) ?(h|horas)\b|en un d[ií]a/i;

export const LOUI_TERMS_CASES: LouiLegalCase[] = [
  {
    question: "Do I have to offer the buyer's agent anything, or can I offer 0%?",
    lang: "en",
    mustNot: [/^(?![^\n]*\bnot\b)[^\n]*\byou (must|need to|are required to) offer\b/im, SAYS_ON_MLS_EN],
    must: [/\bno\b|don't have to|not required|isn't required|your (choice|decision)/i, /0 ?%|zero percent/i],
  },
  {
    question: "¿Tengo que ofrecerle compensación al agente del comprador o puedo poner 0%?",
    lang: "es",
    mustNot: [/^(?![^\n]*\bno tienes\b)[^\n]*\btienes que ofrecer\b/im, SAYS_ON_MLS_ES, USTED, NOT_GLOSSARY_ES],
    must: [/\bno\b|tú decides|es tu decisión/i, /0 ?%/],
  },
  {
    question: "Can I offer the buyer's agent a flat $10,000 instead of a percentage?",
    lang: "en",
    mustNot: [/\bonly (a )?percentages?\b/i, SAYS_ON_MLS_EN],
    must: [/\byes\b|you can/i],
  },
  {
    question: "¿Puedo ofrecerle al agente del comprador un monto fijo de $10,000 en vez de un porcentaje?",
    lang: "es",
    mustNot: [/solo (un )?porcentaje/i, SAYS_ON_MLS_ES, USTED, NOT_GLOSSARY_ES],
    must: [/\bs[ií]\b|puedes/i],
  },
  {
    question: "How long after I sign until my home is published on the MLS?",
    lang: "en",
    mustNot: [OTHER_TIMING_EN],
    must: [/2 business days|two business days/i, /photos|details|documents/i],
  },
  {
    question: "¿Cuánto tardan en publicar mi casa en el MLS?",
    lang: "es",
    mustNot: [OTHER_TIMING_ES, USTED, NOT_GLOSSARY_ES],
    must: [/2 d[ií]as h[aá]biles|dos d[ií]as h[aá]biles/i, /fotos|datos|documentos/i],
  },
  {
    question: "If I change my mind after paying, do I get my money back?",
    lang: "en",
    mustNot: [/partial refund/i, /within \d+ days/i],
    must: [/full refund|refund in full|refund/i, /before[^.]*publish|publish[^.]*before|cancel[^.]*before/i],
  },
  {
    question: "Si me arrepiento después de pagar, ¿me devuelven el dinero?",
    lang: "es",
    mustNot: [/reembolso parcial/i, /dentro de \d+ d[ií]as/i, USTED, NOT_GLOSSARY_ES],
    must: [/devolvemos|reembols|devuelve/i, /antes de (la )?publicaci|antes de que[^.]{0,40}publi(c|qu)/i],
  },
  {
    question: "Can I set up an alert for new condos in Brickell under $600k?",
    lang: "en",
    mustNot: [OFFERS_ALERTS_EN, /^\s*(yes|sure|absolutely)\b/i],
    must: [/\bbroker\b/i],
  },
  {
    question: "¿Me puedes avisar cuando salgan casas nuevas en Coral Gables? ¿Tienen alertas de búsqueda?",
    lang: "es",
    mustNot: [OFFERS_ALERTS_ES, /^\s*(s[ií]|claro)\b/i, USTED, NOT_GLOSSARY_ES],
    must: [/\bbroker\b/i],
  },
];
