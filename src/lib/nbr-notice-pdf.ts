// PDF del aviso NBR aceptado: el texto que rige (inglés), la traducción de cortesía si el
// comprador lo vio en español, y la evidencia de la aceptación. Se manda al comprador y a la
// broker. Fuentes estándar del PDF (Helvetica, WinAnsi): cubren los acentos del español.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { brokerageLicenseLine } from "@/config/brokerage";
import { NBR_NOTICE_EN, NBR_NOTICE_ES, formatNyDateTime, type NbrNoticeText } from "@/lib/nbr-notice";

export interface NbrPdfInput {
  lang: "en" | "es";
  fullName: string;
  email: string;
  phone: string | null;
  listingLabel: string | null;
  noticeVersion: string;
  acceptedAt: string;
  ip: string;
  userAgent: string;
  textSha256: string;
}

const PAGE = { w: 612, h: 792, margin: 56 };
const SIZE = 10.5;

/** Corta un texto en líneas que caben en `width` con esa fuente y tamaño. */
export function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= width || !line) line = next;
      else {
        out.push(line);
        line = word;
      }
    }
    out.push(line);
  }
  return out;
}

export async function renderNbrNoticePdf(input: NbrPdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(NBR_NOTICE_EN.title);
  doc.setAuthor("Lixtara");
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const width = PAGE.w - PAGE.margin * 2;

  // Lo que escribió el comprador (nombre, user agent) puede traer caracteres que Helvetica no
  // tiene (emoji, otros alfabetos): pdf-lib fallaría al escribirlos. Se cambian por "?".
  const charset = new Set(regular.getCharacterSet());
  const safe = (t: string) => Array.from(t, (c) => (c === "\n" || charset.has(c.codePointAt(0)!) ? c : "?")).join("");

  let page: PDFPage = doc.addPage([PAGE.w, PAGE.h]);
  let y = PAGE.h - PAGE.margin;
  const write = (text: string, font: PDFFont = regular, size = SIZE, gap = 4) => {
    for (const l of wrap(safe(text), font, size, width)) {
      if (y < PAGE.margin + size) {
        page = doc.addPage([PAGE.w, PAGE.h]);
        y = PAGE.h - PAGE.margin;
      }
      page.drawText(l, { x: PAGE.margin, y: y - size, size, font, color: rgb(0.11, 0.11, 0.11) });
      y -= size + 3;
    }
    y -= gap;
  };

  // Mismo tamaño de letra que el resto (475.278(4)(b)); la primera oración en mayúsculas y negrita.
  const notice = (t: NbrNoticeText, label: string | null) => {
    if (label) write(label, regular, 9, 6);
    write(t.title, bold, SIZE, 6);
    write(t.lead, bold, SIZE, 6);
    write(t.intro);
    for (const d of t.duties) write(d, regular, SIZE, 2);
    y -= 10;
  };

  const es = input.lang === "es";
  notice(NBR_NOTICE_EN, es ? "Governing version / Versión que rige" : null);
  if (es) notice(NBR_NOTICE_ES, "Traducción de cortesía (no rige) / Courtesy translation (not governing)");

  write(es ? "Aceptación electrónica / Electronic acceptance" : "Electronic acceptance", bold, SIZE, 6);
  const rows: Array<[string, string]> = [
    ["Name / Nombre", input.fullName],
    ["Email / Correo", input.email],
    ["Phone / Teléfono", input.phone ?? "—"],
    ["Property / Propiedad", input.listingLabel ?? "—"],
    ["Date / Fecha", formatNyDateTime(input.acceptedAt, "en")],
    ["Notice version / Versión", input.noticeVersion],
    ["Language shown / Idioma", es ? "Spanish + English / Español + inglés" : "English"],
    ["IP", input.ip],
    ["User agent", input.userAgent],
    ["Text SHA-256", input.textSha256],
  ];
  for (const [k, v] of rows) write(`${k}: ${v}`, regular, 9, 1);
  y -= 8;
  write(
    "Signature: accepted electronically by checking the acceptance box and typing the name above. / Firma: aceptado electrónicamente al marcar la casilla y escribir el nombre de arriba.",
    regular,
    9,
    8,
  );
  write(brokerageLicenseLine("en"), regular, 8, 0);
  return doc.save();
}
