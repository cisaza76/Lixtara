import Link from "next/link";
import { notFound } from "next/navigation";
import { isLocale } from "@/lib/i18n";
import { assertStaff } from "@/lib/admin-auth";
import { createService } from "@/lib/supabase/service";
import { CopyButton } from "@/components/copy-button";
import {
  buildMatrixInputSheet,
  matrixSheetToText,
  type MatrixSourcePhoto,
  type MatrixSourceProperty,
} from "@/lib/matrix-input-sheet";

// Ficha para dar de alta el listing a mano en Matrix: MIAMI no tiene API de carga
// (ver src/lib/matrix-input-sheet.ts). Solo staff.

const PROPERTY_COLUMNS =
  "address_street,address_city,address_state,address_zip,property_type,bedrooms,bathrooms,sqft,lot_size,year_built,list_price,description,showing_instructions,occupancy_status,folio,legal_description,parking_spaces,hoa_fee,tax_annual_amount,has_pool,cash_only,as_is_sale,flood_zone,appliances,pricing_tier,mls_published_at,buyer_agent_commission,mls_number";

export default async function MatrixInputSheetPage({
  params,
}: {
  params: Promise<{ lang: string; id: string }>;
}) {
  const { lang, id } = await params;
  if (!isLocale(lang)) notFound();

  const supabase = await assertStaff(lang);
  const { data: property } = await supabase
    .from("properties")
    .select(PROPERTY_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (!property) notFound();
  const prop = property as MatrixSourceProperty & { mls_number: string | null };

  // property_photos has no staff SELECT policy for drafts (same as the review page).
  const { data: photoRows } = await createService()
    .from("property_photos")
    .select("url,is_primary,display_order")
    .eq("property_id", id)
    .order("display_order", { ascending: true });

  const sheet = buildMatrixInputSheet(prop, (photoRows ?? []) as MatrixSourcePhoto[]);
  const back = `/${lang}/admin/listings/${id}/review`;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <Link
          href={back}
          className="text-[10px] uppercase tracking-[0.22em] text-ink/55 hover:text-gold transition-colors print:hidden"
        >
          ← Listing review
        </Link>
        <h1 className="font-display text-3xl text-ink font-normal">Matrix input sheet</h1>
        <p className="text-sm text-ink/60">
          {prop.address_street}, {prop.address_city} {prop.address_zip}
          {sheet ? ` · ${sheet.formName}` : ""}
        </p>
      </div>

      {!sheet ? (
        <p className="border border-gold-soft p-6 text-sm text-ink/70">
          There is no RE1/RE2 sheet for this property type ({prop.property_type ?? "unknown"}).
          Multi-family listings use the SEF RIN input sheet in Matrix.
        </p>
      ) : (
        <>
          <div className="border border-gold-soft bg-gold/5 p-4 text-sm text-ink/80 flex flex-col gap-2">
            <p>
              MIAMI MLS has no listing-upload API, so the listing is entered by hand in Matrix.
              Copy each value into the matching Matrix field. Empty fields are for you to
              complete; fields marked <strong>verify</strong> are suggestions to confirm.
            </p>
            <p>
              Once it is live in Matrix, record the MLS number on the{" "}
              <Link href={back} className="underline hover:text-gold">
                listing review
              </Link>
              {prop.mls_number ? ` (current: ${prop.mls_number})` : ""}.
            </p>
            <div className="flex flex-wrap gap-3 pt-1">
              <CopyButton
                text={matrixSheetToText(sheet)}
                label="Copy all as text"
                copiedLabel="Copied all"
                className="px-4 py-2 bg-ink text-ivory text-[10px] font-medium tracking-[0.22em] uppercase hover:bg-ink/85 transition-colors print:hidden"
              />
              <a
                href="https://www.miamirealtors.com/mls/mls-forms/"
                target="_blank"
                rel="noopener noreferrer"
                className="px-4 py-2 border border-gold-soft text-[10px] tracking-[0.22em] uppercase text-ink hover:border-gold transition-colors print:hidden"
              >
                Official input sheets ↗
              </a>
            </div>
          </div>

          {sheet.sections.map((section) => (
            <section key={section.title} className="border border-gold-soft break-inside-avoid">
              <h2 className="px-4 py-2 text-[10px] uppercase tracking-[0.18em] text-gold font-semibold border-b border-gold-soft">
                {section.title}
              </h2>
              <dl className="divide-y divide-gold-soft/60">
                {section.rows.map((r) => (
                  <div key={r.label} className="grid grid-cols-1 sm:grid-cols-[13rem_1fr_auto] gap-x-4 gap-y-1 px-4 py-3 items-start">
                    <dt className="text-xs text-ink/60">
                      {r.label}
                      {r.verify && (
                        <span className="ml-2 text-[8px] uppercase tracking-[0.18em] px-1.5 py-0.5 bg-amber-100 text-amber-900">
                          verify
                        </span>
                      )}
                    </dt>
                    <dd className="text-sm text-ink min-w-0">
                      {r.value ? (
                        <span className="whitespace-pre-line break-words">{r.value}</span>
                      ) : (
                        <span className="text-ink/40 italic">Complete in Matrix</span>
                      )}
                      {r.hint && <p className="text-xs text-ink/55 mt-1">{r.hint}</p>}
                    </dd>
                    {r.value ? <CopyButton text={r.value} /> : <span />}
                  </div>
                ))}
              </dl>
            </section>
          ))}

          <section className="border border-gold-soft">
            <h2 className="px-4 py-2 text-[10px] uppercase tracking-[0.18em] text-gold font-semibold border-b border-gold-soft">
              Photos ({sheet.photos.length}, primary first)
            </h2>
            {sheet.photos.length === 0 ? (
              <p className="px-4 py-3 text-sm text-ink/55 italic">No photos uploaded.</p>
            ) : (
              <ol className="px-4 py-3 flex flex-col gap-1 list-decimal list-inside text-sm">
                {sheet.photos.map((url) => (
                  <li key={url} className="break-all">
                    <a href={url} target="_blank" rel="noopener noreferrer" download className="underline hover:text-gold">
                      {url.split("/").pop()}
                    </a>
                  </li>
                ))}
              </ol>
            )}
            <p className="px-4 pb-3 text-xs text-ink/55">
              Open each photo, save it, and upload it in Matrix in this order.
            </p>
          </section>
        </>
      )}
    </div>
  );
}
