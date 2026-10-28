// PDF del aviso NBR aceptado: el texto que rige (inglés) y, al lado, la traducción de
// cortesía con la línea de que rige el inglés; debajo, el consentimiento E-SIGN que aceptó y
// la evidencia. Se manda al comprador y a la broker. Fuentes estándar del PDF (Helvetica,
// WinAnsi): cubren los acentos del español. Todo el aviso al mismo tamaño de letra; la
// primera oración en mayúsculas y negrita (475.278(4)(b)).
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { brokerageLicenseLine } from "@/config/brokerage";
import {
  NBR_ES_GOVERNING_LINE,
  NBR_NOTICE_EN,
  NBR_NOTICE_ES,
  esignConsentText,
  formatNyDateTime,
} from "@/lib/nbr-notice";
import { CONTACT } from "@/config/contact";

export interface NbrPdfInput {
  lang: "en" | "es";
  fullName: string;
  email: string;
  phone: string | null;
  listingLabel: string | null;
  noticeVersion: string;
  esignVersion: string;
  acceptedAt: string;
  ip: string;
  userAgent: string;
  textSha256: string;
}

const PAGE = { w: 612, h: 792, margin: 48 };
const SIZE = 10;
const GAP = 20;

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
  const full = PAGE.w - PAGE.margin * 2;
  const col = (full - GAP) / 2;

  // Lo que escribió el comprador (nombre, user agent) puede traer caracteres que Helvetica no
  // tiene (emoji, otros alfabetos): pdf-lib fallaría al escribirlos. Se cambian por "?".
  const charset = new Set(regular.getCharacterSet());
  const safe = (t: string) => Array.from(t, (c) => (c === "\n" || charset.has(c.codePointAt(0)!) ? c : "?")).join("");

  let page: PDFPage = doc.addPage([PAGE.w, PAGE.h]);
  let y = PAGE.h - PAGE.margin;
  const lineH = (size: number) => size + 3;
  const ensure = (h: number) => {
    if (y - h < PAGE.margin) {
      page = doc.addPage([PAGE.w, PAGE.h]);
      y = PAGE.h - PAGE.margin;
    }
  };
  const draw = (l: string, x: number, font: PDFFont, size: number) =>
    page.drawText(l, { x, y: y - size, size, font, color: rgb(0.11, 0.11, 0.11) });

  /** Un bloque en inglés y su par en español, uno al lado del otro, alineados por arriba. */
  const pair = (en: string, es: string, font: PDFFont, size = SIZE, gap = 6) => {
    const a = wrap(safe(en), font, size, col);
    const b = wrap(safe(es), font, size, col);
    const n = Math.max(a.length, b.length);
    ensure(n * lineH(size));
    for (let i = 0; i < n; i++) {
      if (a[i]) draw(a[i], PAGE.margin, font, size);
      if (b[i]) draw(b[i], PAGE.margin + col + GAP, font, size);
      y -= lineH(size);
    }
    y -= gap;
  };
  const write = (text: string, font: PDFFont = regular, size = 9, gap = 3) => {
    for (const l of wrap(safe(text), font, size, full)) {
      ensure(lineH(size));
      draw(l, PAGE.margin, font, size);
      y -= lineH(size);
    }
    y -= gap;
  };

  pair("English (governing)", NBR_ES_GOVERNING_LINE, regular, 8, 8);
  pair(NBR_NOTICE_EN.title, NBR_NOTICE_ES.title, bold);
  pair(NBR_NOTICE_EN.lead, NBR_NOTICE_ES.lead, bold);
  pair(NBR_NOTICE_EN.intro, NBR_NOTICE_ES.intro, regular);
  NBR_NOTICE_EN.duties.forEach((d, i) => pair(d, NBR_NOTICE_ES.duties[i], regular, SIZE, 2));
  y -= 12;

  const es = input.lang === "es";
  const contact = { email: CONTACT.inboxEmail, phone: CONTACT.phoneDisplay };
  write(es ? "Consentimiento E-SIGN aceptado / E-SIGN consent accepted" : "E-SIGN consent accepted", bold, SIZE, 4);
  write(esignConsentText(input.lang, contact), regular, 9, 10);

  write(es ? "Aceptación electrónica / Electronic acceptance" : "Electronic acceptance", bold, SIZE, 4);
  const rows: Array<[string, string]> = [
    ["Name / Nombre", input.fullName],
    ["Email / Correo", input.email],
    ["Phone / Teléfono", input.phone ?? "—"],
    ["Property / Propiedad", input.listingLabel ?? "—"],
    ["Date / Fecha", formatNyDateTime(input.acceptedAt, "en")],
    ["Notice version / Versión del aviso", input.noticeVersion],
    ["E-SIGN version / Versión E-SIGN", input.esignVersion],
    ["Page language / Idioma de la página", es ? "Spanish / Español" : "English / Inglés"],
    ["IP", input.ip],
    ["User agent", input.userAgent],
    ["Text SHA-256", input.textSha256],
  ];
  for (const [k, v] of rows) write(`${k}: ${v}`, regular, 9, 0);
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
