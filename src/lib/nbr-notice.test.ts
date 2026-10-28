// Aviso NBR (F.S. 475.278(4)) y consentimiento E-SIGN: texto legal exacto, formato, quién lo
// recibe y la regla de confirmación (aviso aceptado + correo verificado, o datos del agente).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BROKERAGE } from "@/config/brokerage";
import {
  ESIGN_VERSION,
  NBR_COPY,
  NBR_ES_GOVERNING_LINE,
  NBR_LEGAL_REVIEW_PENDING,
  NBR_NOTICE_EN,
  NBR_NOTICE_ES,
  NBR_NOTICE_VERSION,
  esignConsentText,
  hasOwnAgent,
  nbrBlockReason,
  nbrStatusLine,
  needsNbrNotice,
  normalizeAgentLicense,
  noticePlainText,
  noticeTextsFor,
  parseBuyerAgent,
  showingWaitLabel,
} from "@/lib/nbr-notice";

const contact = { email: "test@example.com", phone: "+1 (305) 555-0100" };

function keysOf(o: unknown, prefix = ""): string[] {
  if (typeof o !== "object" || o === null) return [prefix];
  return Object.entries(o).flatMap(([k, v]) => keysOf(v, prefix ? `${prefix}.${k}` : k));
}

describe("texto del aviso", () => {
  it("el inglés es 475.278(4)(c) palabra por palabra, con la entidad de src/config/brokerage.ts", () => {
    expect(NBR_NOTICE_EN.title).toBe("NO BROKERAGE RELATIONSHIP NOTICE");
    expect(NBR_NOTICE_EN.lead).toBe(
      "FLORIDA LAW REQUIRES THAT REAL ESTATE LICENSEES WHO HAVE NO BROKERAGE RELATIONSHIP WITH A POTENTIAL SELLER OR BUYER DISCLOSE THEIR DUTIES TO SELLERS AND BUYERS.",
    );
    expect(NBR_NOTICE_EN.intro).toBe(
      `As a real estate licensee who has no brokerage relationship with you, ${BROKERAGE.legalName} and its Associates owe to you the following duties:`,
    );
    expect(NBR_NOTICE_EN.duties).toEqual([
      "1. Dealing honestly and fairly;",
      "2. Disclosing all known facts that materially affect the value of residential real property which are not readily observable to the buyer.",
      "3. Accounting for all funds entrusted to the licensee.",
    ]);
  });

  it("primera oración en mayúsculas y negrita, del MISMO tamaño que el resto (pantalla y PDF)", () => {
    expect(NBR_NOTICE_EN.lead).toBe(NBR_NOTICE_EN.lead.toUpperCase());
    const component = readFileSync("src/components/nbr-notice-text.tsx", "utf8");
    expect(component).toContain('<p className="font-bold">{t.lead}</p>');
    // El tamaño lo da el contenedor (text-sm); ningún párrafo del aviso cambia de tamaño.
    const notice = component.slice(component.indexOf("export function NbrNoticeText"), component.indexOf("export function EsignConsent"));
    expect(notice.match(/text-(xs|base|lg|xl|\[)/g) ?? []).toEqual([]);
    const pdf = readFileSync("src/lib/nbr-notice-pdf.ts", "utf8");
    expect(pdf).toContain("pair(NBR_NOTICE_EN.lead, NBR_NOTICE_ES.lead, bold);");
    expect(pdf).toContain("pair(NBR_NOTICE_EN.intro, NBR_NOTICE_ES.intro, regular);");
  });

  it("inglés y español lado a lado; la columna en español dice que rige el inglés", () => {
    expect(noticeTextsFor()).toEqual([NBR_NOTICE_EN, NBR_NOTICE_ES]);
    expect(NBR_ES_GOVERNING_LINE).toBe("Traducción de cortesía. Rige la versión en inglés.");
  });

  it("la traducción usa usted (documento legal) y tiene los tres deberes", () => {
    expect(NBR_NOTICE_ES.intro).toContain("con usted");
    expect(NBR_NOTICE_ES.intro).toContain(`${BROKERAGE.legalName} y sus Asociados`);
    expect(NBR_NOTICE_ES.duties).toHaveLength(3);
  });

  it("aviso y E-SIGN marcados como pendientes de revisión legal; los dos entran en el texto guardado", () => {
    expect(NBR_LEGAL_REVIEW_PENDING).toBe(true);
    expect(NBR_NOTICE_VERSION).toContain("pending-legal-review");
    expect(ESIGN_VERSION).toContain("pending-legal-review");
    const plain = noticePlainText("es", contact);
    for (const part of [NBR_NOTICE_VERSION, ESIGN_VERSION, esignConsentText("es", contact), NBR_NOTICE_EN.lead, NBR_NOTICE_ES.lead, NBR_ES_GOVERNING_LINE]) {
      expect(plain).toContain(part);
    }
  });

  it("EN y ES con las mismas claves", () => {
    expect(keysOf(NBR_COPY.es).sort()).toEqual(keysOf(NBR_COPY.en).sort());
  });

  it("la línea de 'No estoy seguro' (decisión del 28-oct)", () => {
    expect(NBR_COPY.es.haveAgentLine).toBe("Si tiene un acuerdo con un agente, avísenos para coordinar la visita con él.");
  });
});

describe("consentimiento E-SIGN (15 U.S.C. §7001(c))", () => {
  for (const lang of ["en", "es"] as const) {
    it(`${lang}: copia en papel, retiro, alcance, cómo actualizar el contacto y requisitos técnicos`, () => {
      const t = esignConsentText(lang, contact);
      expect(t).toContain("7001(c)");
      expect(t).toContain(contact.email);
      expect(t).toContain(contact.phone);
      const must =
        lang === "en"
          ? ["paper copy", "no charge", "withdraw this consent", "covers only this notice", "update your email", "web browser", "PDF"]
          : ["copia en papel", "sin costo", "retirar este consentimiento", "cubre solo este aviso", "actualizar su correo", "navegador web", "PDF"];
      for (const m of must) expect(t, m).toContain(m);
    });
  }
});

describe("quién recibe el aviso y datos del agente", () => {
  it("con agente (exclusivo o no): sin aviso; sin agente, sin saberlo o sin respuesta: con aviso", () => {
    expect(hasOwnAgent("exclusive")).toBe(true);
    expect(hasOwnAgent("non_exclusive")).toBe(true);
    for (const s of ["none", "unsure", null, undefined, ""]) expect(needsNbrNotice(s)).toBe(true);
  });

  it("licencia y datos del agente", () => {
    expect(normalizeAgentLicense(" sl 345678 ")).toBe("SL345678");
    expect(normalizeAgentLicense("ask me")).toBeNull();
    const get = (o: Record<string, string>) => (k: string) => o[k];
    const full = { buyer_agent_name: "Ana", buyer_agent_brokerage: "Acme Realty", buyer_agent_email: "A@Example.com", buyer_agent_license: "BK123456" };
    expect(parseBuyerAgent(get(full))).toEqual({ name: "Ana", brokerage: "Acme Realty", email: "a@example.com", license: "BK123456" });
    expect(parseBuyerAgent(get({ ...full, buyer_agent_brokerage: "" }))).toBeNull();
    expect(parseBuyerAgent(get({ ...full, buyer_agent_email: "nope" }))).toBeNull();
  });
});

describe("sin aviso aceptado y correo verificado no hay visita confirmada", () => {
  const base = { agentStatus: "none", agentName: null, agentEmail: null, nbrAcceptedAt: null, emailVerifiedAt: null };
  it("sin agente: aviso aceptado y, además, correo verificado", () => {
    expect(nbrBlockReason(base)).toBe("nbr_notice_missing");
    expect(nbrBlockReason({ ...base, agentStatus: "unsure" })).toBe("nbr_notice_missing");
    expect(nbrBlockReason({ ...base, nbrAcceptedAt: "2026-10-29T15:00:00Z" })).toBe("nbr_email_unverified");
    expect(nbrBlockReason({ ...base, nbrAcceptedAt: "2026-10-29T15:00:00Z", emailVerifiedAt: "2026-10-29T15:05:00Z" })).toBeNull();
  });
  it("con agente: nombre y correo del agente, no el aviso", () => {
    expect(nbrBlockReason({ ...base, agentStatus: "exclusive" })).toBe("nbr_buyer_agent_missing");
    expect(nbrBlockReason({ ...base, agentStatus: "exclusive", agentName: "Ana", agentEmail: "a@example.com" })).toBeNull();
  });
});

describe("ficha del admin", () => {
  it("'Aviso NBR: aceptado [fecha] · pendiente de verificación' / '· correo verificado [fecha]' / 'pendiente'", () => {
    const acc = "2026-10-29T15:04:05Z";
    expect(nbrStatusLine({ agentStatus: "none", acceptedAt: acc, sentAt: null, emailVerifiedAt: null }, "es")).toMatch(
      /^Aviso NBR: aceptado .*11:04:05.* ET \(America\/New_York\) · pendiente de verificación del correo$/,
    );
    expect(nbrStatusLine({ agentStatus: "none", acceptedAt: acc, sentAt: null, emailVerifiedAt: "2026-10-29T15:10:00Z" }, "en")).toMatch(
      /^NBR notice: accepted .* · email verified .*11:10:00.*$/,
    );
    expect(nbrStatusLine({ agentStatus: "none", acceptedAt: null, sentAt: null, emailVerifiedAt: null }, "es")).toBe("Aviso NBR: pendiente");
    expect(nbrStatusLine({ agentStatus: "exclusive", acceptedAt: null, sentAt: null, emailVerifiedAt: null }, "es")).toBeNull();
  });

  it("estado de espera: con agente, 'pendiente de coordinar con el agente del comprador'; sin verificar, 'pendiente de verificación'", () => {
    expect(showingWaitLabel({ agentStatus: "exclusive", status: "received", block: null }, "es")).toBe("Pendiente de coordinar con el agente del comprador");
    expect(showingWaitLabel({ agentStatus: "none", status: "contacted", block: "nbr_email_unverified" }, "es")).toBe("Pendiente de verificación");
    expect(showingWaitLabel({ agentStatus: "exclusive", status: "showing_confirmed", block: null }, "es")).toBeNull();
  });
});
