// Paquete para el abogado (textos legales v1, 2026-10-18): exporta a PDF, desde el MISMO código
// que publica el sitio, los Términos y la Privacidad (EN), el aviso E-SIGN del paso 7 (EN y ES)
// y una hoja con la casilla del checkout y la compensación al agente del comprador.
//
//   pnpm legal:package            → docs/legal/paquete-abogado-2026-10/*.pdf
//
// Usa el Chromium headless de Playwright (CHROME_BIN para otra ruta). No toca ninguna base.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { termsDoc } from "@/lib/legal/terms";
import { privacyDoc } from "@/lib/legal/privacy";
import type { LegalDoc, LegalSection } from "@/lib/legal/types";
import { LEGAL_DOCS } from "@/lib/legal/config";
import { CONSENTS, consentCheckbox, consentNotice } from "@/lib/legal/consents";
import { buyerAgentComp, refundPolicy } from "@/config/legal-terms";
import { legalServicesDisclosure } from "@/config/legalPartner";
import { BROKERAGE } from "@/config/brokerage";
import { PRICING_TIERS, TIER_ORDER } from "@/lib/pricing-tiers";

const ROOT = resolve(__dirname, "../..");
const OUT = join(ROOT, "docs/legal/paquete-abogado-2026-10");
const CHROME =
  process.env.CHROME_BIN ??
  join(
    process.env.HOME ?? "",
    "Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell",
  );
const STATUS = "DRAFT v1 — PENDING LEGAL APPROVAL (pendiente de aprobación legal)";
const GENERATED = "2026-10-18";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function page(title: string, body: string, compact = false): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title><style>
  @page { size: Letter; margin: 0.8in 0.85in; }
  body { font-family: Georgia, "Times New Roman", serif; font-size: 10.5pt; line-height: 1.45; color: #111; }
  h1 { font-size: 18pt; margin: 0 0 4pt; } h2 { font-size: 12.5pt; margin: 16pt 0 4pt; } h3 { font-size: 11pt; margin: 10pt 0 3pt; }
  h1, h2, h3 { break-after: avoid; page-break-after: avoid; }
  p { margin: 0 0 6pt; white-space: pre-line; } ul { margin: 0 0 6pt 18pt; padding: 0; } li { margin: 0 0 3pt; }
  .status { font-family: Arial, sans-serif; font-size: 8.5pt; letter-spacing: .04em; color: #8a1c1c; border: 1px solid #8a1c1c; padding: 4pt 6pt; margin: 0 0 10pt; }
  .meta { font-family: Arial, sans-serif; font-size: 8.5pt; color: #555; margin: 0 0 12pt; }
  .box { border: 1px solid #999; padding: 8pt 10pt; margin: 0 0 8pt; }
  .label { font-family: Arial, sans-serif; font-size: 8pt; text-transform: uppercase; letter-spacing: .06em; color: #555; margin: 0 0 3pt; }
  table { border-collapse: collapse; width: 100%; font-size: 9.5pt; } td, th { border: 1px solid #bbb; padding: 4pt 6pt; vertical-align: top; text-align: left; }
  ${compact ? "@page { margin: 0.5in 0.6in; }" : ""}
  body.compact { font-size: 8.8pt; line-height: 1.32; } .compact h1 { font-size: 14pt; } .compact h2 { font-size: 11pt; margin: 9pt 0 3pt; }
  .compact td, .compact th { padding: 2pt 4pt; font-size: 8.3pt; line-height: 1.25; } .compact .box { padding: 5pt 8pt; margin: 0 0 5pt; } .compact p { margin: 0 0 4pt; }
  </style></head><body${compact ? ' class="compact"' : ""}><div class="status">${esc(STATUS)}</div>${body}</body></html>`;
}

function section(s: LegalSection, level: number): string {
  const h = level === 0 ? "h2" : "h3";
  return [
    `<${h}>${esc(s.heading)}</${h}>`,
    ...s.body.map((p) => `<p>${esc(p)}</p>`),
    s.bullets ? `<ul>${s.bullets.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>` : "",
    ...(s.sub ?? []).map((x) => section(x, level + 1)),
  ].join("");
}

function legalDoc(doc: LegalDoc, meta: { version: string; updated: string }, extra = ""): string {
  return page(
    doc.title,
    `<h1>${esc(doc.title)}</h1><div class="meta">Last updated: ${meta.updated} · Version ${esc(meta.version)} · ${esc(
      BROKERAGE.legalName,
    )}</div>${doc.intro.map((p) => `<p>${esc(p)}</p>`).join("")}${doc.sections.map((s) => section(s, 0)).join("")}${extra}`,
  );
}

function esignNotice(): string {
  const block = (lang: "en" | "es", heading: string) =>
    `<h2>${heading}</h2><div class="box">${consentNotice("esign", lang)
      .map((p) => `<p>${esc(p)}</p>`)
      .join("")}<p>☐ ${esc(consentCheckbox("esign", lang).before)}</p></div>`;
  return page(
    "E-SIGN notice — step 7",
    `<h1>E-SIGN notice and consent (listing flow, step 7)</h1><div class="meta">Version ${esc(
      CONSENTS.esign.version,
    )} · shown before the seller opens DocuSign; the server requires the checkbox and records date, IP, user agent, version and SHA-256 of this exact text (terms_acceptances).</div>${block(
      "en",
      "English",
    )}${block("es", "Español (shown to Spanish-language users; informal “tú”, like the rest of the seller flow)")}`,
  );
}

function onePager(): string {
  const rows = TIER_ORDER.map((t) => {
    const name = t.charAt(0).toUpperCase() + t.slice(1);
    return `<tr><td><strong>${name}</strong><br>$${PRICING_TIERS[t].flatFee} + ${PRICING_TIERS[t].commissionPct}%</td><td>☐ ${esc(
      consentCheckbox("terms_refund", "en", t).before,
    )}</td><td>☐ ${esc(consentCheckbox("terms_refund", "es", t).before)}</td></tr>`;
  }).join("");
  const comp = buyerAgentComp.text;
  return page(
    "Checkout checkbox and buyer's agent compensation",
    `<h1>Checkout checkbox and buyer's agent compensation (one page)</h1>
    <div class="meta">Generated ${GENERATED}. Checkout checkbox version ${esc(CONSENTS.terms_refund.version)} (= Terms version) · buyer's agent compensation text v${esc(
      buyerAgentComp.version,
    )} · refund policy v${esc(refundPolicy.version)}.</div>
    <h2>1. Checkout checkbox (listing flow, step 8)</h2>
    <p>Required before “Pay with Stripe”. {fee} and {pct} come from the seller's plan; the exact text shown (with the plan's amounts) is what is hashed and recorded.</p>
    <table><tr><th style="width:14%">Plan</th><th>English</th><th>Español</th></tr>${rows}</table>
    <p class="label" style="margin-top:8pt">Consistent with the refund policy shown in Terms §6, the FAQ and step 8 (EN):</p>
    <div class="box"><p>${esc(refundPolicy.text.en)}</p></div>
    <h2>2. Buyer's agent compensation (site, FAQ, Terms §4.1, Loui)</h2>
    <p class="label">English (site, FAQ, Terms, Loui)</p><div class="box"><p>${esc(comp.en.policy)}</p></div>
    <p class="label">Español — sitio y FAQ (tú)</p><div class="box"><p>${esc(comp.es.policy)}</p></div>
    <p class="label">Español — Términos §4.1 (registro formal)</p><div class="box"><p>${esc(comp.es.policyTerms)}</p></div>`,
    true,
  );
}

function main() {
  if (!existsSync(CHROME)) throw new Error(`No encuentro Chromium headless en ${CHROME}. Usa CHROME_BIN=...`);
  mkdirSync(OUT, { recursive: true });
  const tmp = mkdtempSync(join(tmpdir(), "lixtara-legal-"));
  const files: Array<[string, string]> = [
    [
      "terms-of-service-en.pdf",
      legalDoc(
        termsDoc.en,
        LEGAL_DOCS.terms,
        `<h2>Legal services disclosure (shown below the Terms on the site)</h2><p>${esc(legalServicesDisclosure("en"))}</p>`,
      ),
    ],
    ["privacy-policy-en.pdf", legalDoc(privacyDoc.en, LEGAL_DOCS.privacy)],
    ["esign-notice-step7-en-es.pdf", esignNotice()],
    ["checkout-checkbox-and-compensation.pdf", onePager()],
  ];
  for (const [name, html] of files) {
    const htmlPath = join(tmp, name.replace(/\.pdf$/, ".html"));
    writeFileSync(htmlPath, html, "utf8");
    execFileSync(CHROME, [
      "--headless",
      "--disable-gpu",
      "--no-pdf-header-footer",
      `--print-to-pdf=${join(OUT, name)}`,
      `file://${htmlPath}`,
    ], { stdio: "ignore" });
    console.log(join("docs/legal/paquete-abogado-2026-10", name));
  }
}

main();
