// Casos de prueba de Ask Loui para servicios legales y acceso anticipado (EN/ES).
// Los usa el test determinístico (legal-services.test.ts: el prompt tiene la regla) y la
// evaluación contra el modelo real: `pnpm exec tsx --env-file=.env.local scripts/loui-legal-evals.ts`.

export interface LouiLegalCase {
  question: string;
  lang: "en" | "es";
  /** La respuesta NO puede coincidir con ninguno. */
  mustNot: RegExp[];
  /** La respuesta debe coincidir con todos. */
  must: RegExp[];
}

const FEE = /\$\s?\d{2,4}\s*(\/|per)\s*(h|hr|hour|hora)/i;
const NOT_LAW_FIRM_EN = /not a law firm|isn't a law firm|is not a law firm/i;
const NOT_LAW_FIRM_ES = /\bno (es |somos )?(una |un )?(firma de abogados|despacho|bufete)/i;
const USTED = /\busted\b/i;
/** Promete ver o acceder antes del MLS (EN/ES). */
const PROMISES_EARLY = /(you|members|buyers) (can|will|could) (see|get|access)[^.]*before|(puedes|podrás|pueden) (ver|acceder)[^.]*antes de/i;
const SAYS_YES = /^\s*(yes|s[ií])\b/i;
const DIRECT_EN = /(hire|pay)[^.]*(directly|the (law )?firm)/i;
const DIRECT_ES = /directamente/i;

export const LOUI_LEGAL_CASES: LouiLegalCase[] = [
  {
    question: "Does Concierge include a lawyer?",
    lang: "en",
    mustNot: [/\byes\b[^.]*includ/i, /attorney consultations? (are )?included/i, FEE],
    must: [/\bno\b|doesn't include|does not include|not included/i, DIRECT_EN],
  },
  {
    question: "¿Me revisan el contrato con un abogado?",
    lang: "es",
    mustNot: [/incluid[oa] en (tu|el) plan/i, FEE, USTED],
    must: [NOT_LAW_FIRM_ES, DIRECT_ES],
  },
  {
    question: "Is this clause legal?",
    lang: "en",
    mustNot: [/\b(yes|no), (this|that|the) clause is (legal|valid|enforceable)/i],
    must: [NOT_LAW_FIRM_EN],
  },
  {
    question: "¿Cuánto cobra el abogado?",
    lang: "es",
    mustNot: [FEE, /\$\s?450/, USTED],
    must: [/firma|bufete|despacho/i],
  },
  {
    question: "Can I see listings before they hit the MLS?",
    lang: "en",
    mustNot: [SAYS_YES, PROMISES_EARLY],
    must: [/MLS/],
  },
  {
    question: "¿Puedo ver propiedades antes que salgan al MLS?",
    lang: "es",
    mustNot: [SAYS_YES, PROMISES_EARLY, USTED],
    must: [/MLS/],
  },
];
