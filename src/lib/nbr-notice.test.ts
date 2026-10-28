// Aviso NBR (F.S. 475.278(4)): texto legal exacto, quién lo recibe y la regla de confirmación.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BROKERAGE } from "@/config/brokerage";
import {
  NBR_COPY,
  NBR_LEGAL_REVIEW_PENDING,
  NBR_NOTICE_EN,
  NBR_NOTICE_ES,
  NBR_NOTICE_VERSION,
  hasOwnAgent,
  nbrBlockReason,
  nbrStatusLine,
  needsNbrNotice,
  normalizeAgentLicense,
  noticePlainText,
  noticeTextsFor,
} from "@/lib/nbr-notice";

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

  it("la primera oración va en mayúsculas (y en negrita en el componente y el PDF)", () => {
    expect(NBR_NOTICE_EN.lead).toBe(NBR_NOTICE_EN.lead.toUpperCase());
    expect(NBR_NOTICE_ES.lead).toBe(NBR_NOTICE_ES.lead.toUpperCase());
    const component = readFileSync("src/components/nbr-notice-text.tsx", "utf8");
    expect(component).toContain('<p className="font-bold">{t.lead}</p>');
    const pdf = readFileSync("src/lib/nbr-notice-pdf.ts", "utf8");
    expect(pdf).toContain("write(t.lead, bold, SIZE, 6);");
  });

  it("en /es: primero la traducción de cortesía, después el inglés que rige; en /en solo el inglés", () => {
    expect(noticeTextsFor("es")).toEqual([NBR_NOTICE_ES, NBR_NOTICE_EN]);
    expect(noticeTextsFor("en")).toEqual([NBR_NOTICE_EN]);
    expect(NBR_COPY.es.courtesyNote).toContain("La versión en inglés");
    expect(NBR_COPY.es.courtesyNote).toContain("rige");
  });

  it("la traducción usa usted (documento legal) y tiene los tres deberes", () => {
    expect(NBR_NOTICE_ES.intro).toContain("con usted");
    expect(NBR_NOTICE_ES.intro).toContain(`${BROKERAGE.legalName} y sus Asociados`);
    expect(NBR_NOTICE_ES.duties).toHaveLength(3);
  });

  it("marcado como pendiente de revisión legal, y la versión entra en el texto que se guarda", () => {
    expect(NBR_LEGAL_REVIEW_PENDING).toBe(true);
    expect(NBR_NOTICE_VERSION).toContain("pending-legal-review");
    expect(noticePlainText("en").startsWith(NBR_NOTICE_VERSION)).toBe(true);
    expect(noticePlainText("es")).toContain(NBR_NOTICE_EN.lead);
    expect(noticePlainText("es")).toContain(NBR_NOTICE_ES.lead);
  });

  it("EN y ES con las mismas claves", () => {
    expect(keysOf(NBR_COPY.es).sort()).toEqual(keysOf(NBR_COPY.en).sort());
  });
});

describe("quién recibe el aviso", () => {
  it("con agente (exclusivo o no): sin aviso; sin agente, sin saberlo o sin respuesta: con aviso", () => {
    expect(hasOwnAgent("exclusive")).toBe(true);
    expect(hasOwnAgent("non_exclusive")).toBe(true);
    for (const s of ["none", "unsure", null, undefined, ""]) expect(needsNbrNotice(s)).toBe(true);
    expect(needsNbrNotice("non_exclusive")).toBe(false);
  });

  it("licencia de Florida del agente", () => {
    expect(normalizeAgentLicense(" sl 345678 ")).toBe("SL345678");
    expect(normalizeAgentLicense("BK123456")).toBe("BK123456");
    expect(normalizeAgentLicense("3456789")).toBe("3456789");
    expect(normalizeAgentLicense("ask me")).toBeNull();
    expect(normalizeAgentLicense("")).toBeNull();
  });
});

describe("sin aviso no hay visita confirmada", () => {
  const base = { agentStatus: "none", agentName: null, agentLicense: null, nbrAcceptedAt: null };
  it("sin agente: hace falta el aviso aceptado", () => {
    expect(nbrBlockReason(base)).toBe("nbr_notice_missing");
    expect(nbrBlockReason({ ...base, agentStatus: "unsure" })).toBe("nbr_notice_missing");
    expect(nbrBlockReason({ ...base, nbrAcceptedAt: "2026-10-29T15:00:00Z" })).toBeNull();
  });
  it("con agente: hacen falta su nombre y su licencia, no el aviso", () => {
    expect(nbrBlockReason({ ...base, agentStatus: "non_exclusive" })).toBe("nbr_buyer_agent_missing");
    expect(nbrBlockReason({ ...base, agentStatus: "non_exclusive", agentName: "Ana", agentLicense: "SL1" })).toBeNull();
  });
});

describe("línea de la ficha del admin", () => {
  it("'Aviso NBR: aceptado [fecha]' o 'pendiente', con la hora de Miami", () => {
    expect(nbrStatusLine({ agentStatus: "none", acceptedAt: "2026-10-29T15:04:05Z", sentAt: null }, "es")).toMatch(
      /^Aviso NBR: aceptado .*2026.*11:04:05.* ET \(America\/New_York\)$/,
    );
    expect(nbrStatusLine({ agentStatus: "none", acceptedAt: null, sentAt: null }, "es")).toBe("Aviso NBR: pendiente");
    expect(nbrStatusLine({ agentStatus: "unsure", acceptedAt: null, sentAt: "2026-10-29T15:00:00Z" }, "en")).toMatch(
      /^NBR notice: pending \(sent .* ET \(America\/New_York\)\)$/,
    );
    expect(nbrStatusLine({ agentStatus: "exclusive", acceptedAt: null, sentAt: null }, "es")).toBeNull();
  });
});
