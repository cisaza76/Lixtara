// UX 5C (approved 2026-07-28) — terminal email content for the listing video.
// One bilingual message (EN + ES) per terminal outcome, reassuring tone, and the
// strict no-leak contract: no error codes, categories, stderr, internal identifiers,
// or quota vocabulary. The support reference appears ONLY in failure variants.
import type { SellerFailureKind } from "@/lib/creative-studio/seller-failure-kind";

export interface VideoTerminalEmailInput {
  outcome: "completed" | "failed";
  kind?: SellerFailureKind;
  reference?: string | null;
  addressLine: string;
  dashboardUrl: string;
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

  if (input.outcome === "completed") {
    const subject = `Your listing video is ready — ${addr}`;
    const en = `Your listing video for ${addr} is ready. Preview and download it from your dashboard: ${url}`;
    const es = `Tu video del listing de ${addr} está listo. Puedes verlo y descargarlo desde tu panel: ${url}`;
    return {
      subject,
      text: `${en}\n\n${es}\n— Lixtara`,
      html: `<p>${esc(en)}</p><p>${esc(es)}</p><p>— Lixtara</p>`,
    };
  }

  const kind: SellerFailureKind = input.kind ?? "technical_support";
  let subject: string;
  let en: string;
  let es: string;

  if (kind === "source_action_required") {
    subject = `Your listing video needs a different file — ${addr}`;
    en = `We found a problem with the video you uploaded for ${addr} and couldn't process it. Please replace it with another MP4 file — phone camera videos work well: ${url}`;
    es = `Encontramos un problema con el video que subiste para ${addr} y no pudimos procesarlo. Reemplázalo con otro archivo MP4 — los videos de cámara de celular funcionan bien: ${url}`;
  } else if (kind === "technical_retryable") {
    subject = `We couldn't finish your listing video — ${addr}`;
    en = `We couldn't finish the video for ${addr}. Your listing and photos are safe. This sometimes happens — you can try again from your dashboard: ${url}`;
    es = `No pudimos terminar el video de ${addr}. Tu listing y tus fotos están intactos. A veces ocurre — puedes reintentarlo desde tu panel: ${url}`;
  } else {
    subject = `We couldn't finish your listing video — ${addr}`;
    en = `We couldn't finish the video for ${addr}. Your listing and photos are safe. Our team can look into it for you — please contact support and they'll take it from there: ${url}`;
    es = `No pudimos terminar el video de ${addr}. Tu listing y tus fotos están intactos. Nuestro equipo puede revisarlo — contacta a soporte y ellos se encargan: ${url}`;
  }

  const refLineEn = ref ? `Reference: ${ref} — share it with our team so they can find your case right away.` : "";
  const refLineEs = ref ? `Referencia: ${ref} — compártela con nuestro equipo para ubicar tu caso al instante.` : "";
  return {
    subject,
    text: [en, refLineEn, es, refLineEs, "— Lixtara"].filter(Boolean).join("\n\n"),
    html:
      `<p>${esc(en)}</p>` +
      (refLineEn ? `<p><strong>${esc(refLineEn)}</strong></p>` : "") +
      `<p>${esc(es)}</p>` +
      (refLineEs ? `<p>${esc(refLineEs)}</p>` : "") +
      `<p>— Lixtara</p>`,
  };
}
