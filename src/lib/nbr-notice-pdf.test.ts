// PDF del aviso NBR aceptado: se genera con el texto y la evidencia, y no falla con
// caracteres que Helvetica no tiene (nombres o user agents con emoji u otros alfabetos).
import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { renderNbrNoticePdf, wrap } from "@/lib/nbr-notice-pdf";

const input = {
  lang: "es" as const,
  fullName: "José Núñez",
  email: "jose@example.com",
  phone: "+13055550100",
  listingLabel: "123 TEST Street, Miami 33131",
  noticeVersion: "nbr-2026-10-29-pending-legal-review",
  esignVersion: "esign-2026-10-29-pending-legal-review",
  acceptedAt: "2026-10-29T15:04:05Z",
  ip: "203.0.113.7",
  userAgent: "Mozilla/5.0 (TEST)",
  textSha256: "a".repeat(64),
};

describe("renderNbrNoticePdf", () => {
  it("genera un PDF válido con título y al menos una página", async () => {
    const bytes = await renderNbrNoticePdf(input);
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
    expect(doc.getTitle()).toBe("NO BROKERAGE RELATIONSHIP NOTICE");
  });

  it("no falla con emoji ni otros alfabetos en lo que escribió el comprador", async () => {
    const bytes = await renderNbrNoticePdf({ ...input, fullName: "李雷 🏠", userAgent: "UA ✓ 😀", lang: "en" });
    expect(bytes.length).toBeGreaterThan(1000);
  });
});

describe("wrap", () => {
  it("corta en líneas que caben en el ancho", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const lines = wrap("palabra ".repeat(60), font, 10, 200);
    expect(lines.length).toBeGreaterThan(3);
    for (const l of lines) expect(font.widthOfTextAtSize(l, 10)).toBeLessThanOrEqual(200);
  });
});
