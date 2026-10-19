import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dictionaries } from "@/lib/i18n";
import { activityText, type ActivityRow } from "./admin-activity";
import { describeChanges } from "./listing-requests";

const en = (a: ActivityRow) => activityText(a, dictionaries.en.admin.activity, "en");
const es = (a: ActivityRow) => activityText(a, dictionaries.es.admin.activity, "es");
const read = (p: string) => readFileSync(p, "utf8");

const changes = describeChanges({ list_price: { old: 500000, new: 480000 } });

const CASES: Array<[ActivityRow, string]> = [
  [{ action_type: "mls_published_marked", description: "Published on the MLS (A11223344)" }, "Publicado en el MLS (A11223344)"],
  [{ action_type: "mls_number_set", description: "MLS number → A11223344" }, "Número del MLS → A11223344"],
  [
    { action_type: "mls_published_corrected", description: "MLS publication date → cleared. Note: wrong date entered" },
    "Fecha de publicación en el MLS → borrada. Nota: wrong date entered",
  ],
  [{ action_type: "listing_approved", description: "Listing → active" }, "Listado → activo"],
  [{ action_type: "listing_rejected", description: "Listing → withdrawn" }, "Listado → retirado"],
  [{ action_type: "listing_withdrawn", description: "Listing → withdrawn (seller request)" }, "Listado → retirado (a pedido del vendedor)"],
  [
    { action_type: "listing_change_requested", description: `Seller requests: ${changes}\nReason: new price` },
    `El vendedor pide: ${changes}\nMotivo: new price`,
  ],
  [{ action_type: "listing_withdrawal_requested", description: "Seller requests to withdraw this listing." }, "El vendedor pide retirar este listado."],
  [{ action_type: "listing_change_approved", description: changes }, `Cambio aprobado: ${changes}`],
  [{ action_type: "listing_change_rejected", description: "Request rejected" }, "Solicitud rechazada"],
  [{ action_type: "listing_withdrawal_rejected", description: "Not now" }, "Solicitud rechazada: Not now"],
  [{ action_type: "creative_studio.video_source_uploaded", description: "Seller uploaded a source video" }, "El vendedor subió un video de origen"],
];

describe("actividad reciente del admin en el idioma de la página", () => {
  it.each(CASES)("%o → ES", (row, want) => {
    expect(es(row)).toBe(want);
  });

  it("en inglés, los textos del sistema quedan como se guardaron (salvo prefijos de aprobación y rechazo)", () => {
    for (const [row] of CASES) {
      if (/listing_change_approved|_rejected$/.test(row.action_type)) continue;
      expect(en(row)).toBe(row.description);
    }
  });

  it("la fecha corregida se muestra como fecha, en el idioma", () => {
    const row = { action_type: "mls_published_corrected", description: "MLS publication date → 2026-10-15T14:00:00.000Z. Note: typo" };
    expect(es(row)).toBe("Fecha de publicación en el MLS → 15 oct 2026. Nota: typo");
    expect(en(row)).toBe("MLS publication date → Oct 15, 2026. Note: typo");
  });

  it("un texto que no se reconoce se muestra tal cual; sin texto, el action_type", () => {
    expect(es({ action_type: "listing_changes_requested", description: "Fix the photos, please" })).toBe("Fix the photos, please");
    expect(es({ action_type: "something_new", description: null })).toBe("something_new");
  });

  it("los formatos que reconoce siguen siendo los que escribe el sistema", () => {
    expect(read("src/lib/mls-published.server.ts")).toContain("description: `Published on the MLS (${mls.value})`");
    expect(read("src/lib/mls-published.server.ts")).toContain('description: `MLS publication date → ${args.publishedAt ?? "cleared"}. Note: ${note}`');
    expect(read("src/lib/listing-mls-number.server.ts")).toContain("description: `MLS number → ${parsed.value}`");
    const req = read("src/lib/listing-requests.server.ts");
    for (const s of ["`Seller requests: ${describeChanges(changes)}`", '"Seller requests to withdraw this listing."', "`Reason: ${args.reason}`", '"Listing → withdrawn (seller request)"', '"Request rejected"']) {
      expect(req, s).toContain(s);
    }
    expect(read("src/app/[lang]/admin/listings/[id]/review/page.tsx")).toContain("description: note ?? `Listing → ${newStatus}`");
    expect(read("src/app/[lang]/admin/page.tsx")).toContain("activityText(a, copy.activity, lang)");
  });
});
