// UX 5C (approved 2026-07-28) — terminal email content for the listing video.
// One bilingual message (EN + ES) per terminal outcome, reassuring tone, and the
// strict no-leak contract: no error codes, categories, stderr, internal identifiers,
// or quota vocabulary. The support reference appears ONLY in failure variants.
//
// PILOT-COHORT DECISION (owner sign-off, PR #116): the bilingual single message is a
// TEMPORARY decision for the Gate 5C pilot, not the definitive contract — before wide
// opening, these emails should follow the seller's locale (tracked as post-pilot debt).
// `lang` set (seller_leads.locale known) ⇒ the message is ONLY in that language. Unset
// (locale unknown) ⇒ the bilingual pilot message, unchanged.
import type { SellerFailureKind } from "@/lib/creative-studio/seller-failure-kind";

export interface VideoTerminalEmailInput {
  outcome: "completed" | "failed";
  kind?: SellerFailureKind;
  reference?: string | null;
  addressLine: string;
  dashboardUrl: string;
  /** Recipient's language when known; omitted ⇒ bilingual EN + ES. */
  lang?: "en" | "es";
}

export interface BuiltEmail {
  subject: string;
  html: string;
  text: string;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function buildVideoTerminalEmail(input: VideoTerminalEmailInput): BuiltEmail {
  const addr = input.addressLine;
  const url = input.dashboardUrl;
  const ref = input.reference ?? null;
  const lang = input.lang;

  if (input.outcome === "completed") {
    const subjectEn = `Your listing video is ready: ${addr}`;
    const subjectEs = `Tu video del listing está listo: ${addr}`;
    const en = `Your listing video for ${addr} is ready. Preview and download it from your dashboard: ${url}`;
    const es = `Tu video del listing de ${addr} está listo. Puedes verlo y descargarlo desde tu panel: ${url}`;
    if (lang) {
      const only = lang === "es" ? es : en;
      return {
        subject: lang === "es" ? subjectEs : subjectEn,
        text: `${only}\nLixtara`,
        html: `<p>${esc(only)}</p><p>Lixtara</p>`,
      };
    }
    return {
      subject: subjectEn,
      text: `${en}\n\n${es}\nLixtara`,
      html: `<p>${esc(en)}</p><p>${esc(es)}</p><p>Lixtara</p>`,
    };
  }

  const kind: SellerFailureKind = input.kind ?? "technical_support";
  let subject: string;
  let subjectEs: string;
  let en: string;
  let es: string;

  if (kind === "source_action_required") {
    subject = `Your listing video needs a different file: ${addr}`;
    subjectEs = `Tu video del listing necesita otro archivo: ${addr}`;
    en = `We found a problem with the video you uploaded for ${addr} and couldn't process it. Please replace it with another MP4 file. Phone camera videos work well: ${url}`;
    es = `Encontramos un problema con el video que subiste para ${addr} y no pudimos procesarlo. Reemplázalo con otro archivo MP4. Los videos de cámara de celular funcionan bien: ${url}`;
  } else if (kind === "technical_retryable") {
    subject = `We couldn't finish your listing video: ${addr}`;
    subjectEs = `No pudimos terminar tu video del listing: ${addr}`;
    en = `We couldn't finish the video for ${addr}. Your listing and photos are safe. This sometimes happens, and you can try again from your dashboard: ${url}`;
    es = `No pudimos terminar el video de ${addr}. Tu listing y tus fotos están intactos. A veces ocurre, y puedes reintentarlo desde tu panel: ${url}`;
  } else {
    subject = `We couldn't finish your listing video: ${addr}`;
    subjectEs = `No pudimos terminar tu video del listing: ${addr}`;
    en = `We couldn't finish the video for ${addr}. Your listing and photos are safe. Our team can look into it for you. Please contact support and they'll take it from there: ${url}`;
    es = `No pudimos terminar el video de ${addr}. Tu listing y tus fotos están intactos. Nuestro equipo puede revisarlo. Contacta a soporte y ellos se encargan: ${url}`;
  }

  const refLineEn = ref ? `Reference: ${ref}. Share it with our team so they can find your case right away.` : "";
  const refLineEs = ref ? `Referencia: ${ref}. Compártela con nuestro equipo para ubicar tu caso al instante.` : "";
  if (lang) {
    const body = lang === "es" ? es : en;
    const refLine = lang === "es" ? refLineEs : refLineEn;
    return {
      subject: lang === "es" ? subjectEs : subject,
      text: [body, refLine, "Lixtara"].filter(Boolean).join("\n\n"),
      html:
        `<p>${esc(body)}</p>` +
        (refLine ? `<p><strong>${esc(refLine)}</strong></p>` : "") +
        `<p>Lixtara</p>`,
    };
  }
  return {
    subject,
    text: [en, refLineEn, es, refLineEs, "Lixtara"].filter(Boolean).join("\n\n"),
    html:
      `<p>${esc(en)}</p>` +
      (refLineEn ? `<p><strong>${esc(refLineEn)}</strong></p>` : "") +
      `<p>${esc(es)}</p>` +
      (refLineEs ? `<p>${esc(refLineEs)}</p>` : "") +
      `<p>Lixtara</p>`,
  };
}
