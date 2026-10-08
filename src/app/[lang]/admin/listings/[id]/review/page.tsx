import Link from "next/link";
import Image from "next/image";
import { notFound, redirect } from "next/navigation";
import { isLocale } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { createService } from "@/lib/supabase/service";
import { assertStaffWithUser } from "@/lib/admin-auth";
import { parseMlsNumber } from "@/lib/listing-mls-number";
import {
  ensureEnterMlsNumberTask,
  mapMlsNumberWriteError,
  saveListingMlsNumber,
} from "@/lib/listing-mls-number.server";

interface Property {
  id: string;
  owner_id: string;
  address_street: string;
  address_city: string;
  address_state: string;
  address_zip: string;
  property_type: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  sqft: number | null;
  year_built: number | null;
  lot_size: number | null;
  list_price: number | null;
  mls_status: string;
  mls_number: string | null;
  pricing_tier: string | null;
  description: string | null;
  showing_instructions: string | null;
  occupancy_status: string | null;
  monthly_rent: number | null;
  lease_end_date: string | null;
  tenant_cooperation: string | null;
  tenant_notes: string | null;
  legal_description: string | null;
  buyer_agent_commission: number | null;
}

interface Photo {
  id: string;
  url: string;
  is_primary: boolean | null;
  display_order: number | null;
}

interface Agreement {
  status: string;
  signer_name: string | null;
  signer_email: string | null;
  signed_at: string | null;
}

function field(label: string, value: string | number | null | undefined) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-[0.18em] text-ink/55">
        {label}
      </span>
      <span className="text-sm text-ink">
        {value === null || value === undefined || value === "" ? "—" : value}
      </span>
    </div>
  );
}

// Module scope on purpose: a plain function declared inside the page and
// called from its server actions gets captured by them, and Next.js cannot
// serialize a function into the action's bound arguments ("Functions cannot be
// passed directly to Client Components"), which crashed the review page.
async function transition(
  lang: string,
  id: string,
  shortAddress: string,
  newStatus: string,
  actionType: string,
  note: string | null,
  mlsNumber: string | null = null,
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/${lang}/sign-in?next=/admin`);
  const [{ data: a }, { data: b }] = await Promise.all([
    supabase.rpc("has_role", { _role: "admin" }),
    supabase.rpc("has_role", { _role: "broker" }),
  ]);
  if (a !== true && b !== true) redirect(`/${lang}/dashboard`);

  const { error: updateError } = await supabase
    .from("properties")
    .update(mlsNumber ? { mls_status: newStatus, mls_number: mlsNumber } : { mls_status: newStatus })
    .eq("id", id);
  if (mlsNumber && updateError) {
    // Con número, la aprobación va en la MISMA escritura: si el número choca, no se
    // aprueba nada y se avisa.
    redirect(`/${lang}/admin/listings/${id}/review?error=${mapMlsNumberWriteError(updateError)}`);
  }

  if (newStatus === "active" && !mlsNumber) {
    await ensureEnterMlsNumberTask(supabase, id, shortAddress);
  }

  if (newStatus === "active" || newStatus === "withdrawn") {
    await supabase
      .from("broker_tasks")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("property_id", id)
      .eq("task_type", "approve_listing")
      .eq("status", "pending");
  }

  await supabase.from("activity_log").insert({
    user_id: user.id,
    property_id: id,
    action_type: actionType,
    description: note ?? `Listing → ${newStatus}`,
  });

  redirect(`/${lang}/admin/listings/${id}/review?done=${actionType}`);
}

export default async function ListingReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string; id: string }>;
  searchParams: Promise<{ done?: string; error?: string }>;
}) {
  const { lang, id } = await params;
  if (!isLocale(lang)) notFound();
  const sp = await searchParams;

  const supabase = await createClient();
  const { data: property } = await supabase
    .from("properties")
    .select(
      "id,owner_id,address_street,address_city,address_state,address_zip,property_type,bedrooms,bathrooms,sqft,year_built,lot_size,list_price,mls_status,mls_number,pricing_tier,description,showing_instructions,occupancy_status,monthly_rent,lease_end_date,tenant_cooperation,tenant_notes,legal_description,buyer_agent_commission",
    )
    .eq("id", id)
    .maybeSingle();
  if (!property) notFound();
  const prop = property as Property;

  // property_photos and agreements have no admin/broker SELECT policy (only the
  // owner, and the public for ACTIVE listings' photos), so with the session
  // client the review page always showed "no photos" and "no agreement on
  // file" for drafts. Re-check the role here (page data loads in parallel with
  // the admin layout's guard), then read both with the secret key.
  await assertStaffWithUser(lang);
  const svc = createService();
  const [{ data: photoRows }, { data: agreementRow }] = await Promise.all([
    svc
      .from("property_photos")
      .select("id,url,is_primary,display_order")
      .eq("property_id", id)
      .order("display_order", { ascending: true }),
    svc
      .from("agreements")
      .select("status,signer_name,signer_email,signed_at")
      .eq("property_id", id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const photos = (photoRows ?? []) as Photo[];
  const agreement = (agreementRow ?? null) as Agreement | null;

  // ── Broker actions (admin/broker gated). The Lovable workflow statuses
  // (rejected / changes_requested / awaiting_broker_signature) don't exist in
  // this DB's mls_status enum, so we map: Approve→active, Reject→withdrawn,
  // Request Changes→draft. Each is audited in activity_log. ──
  // Solo el texto que necesita la tarea: capturar `prop` entero en las server actions
  // serializaría el listing completo en el formulario.
  const shortAddress = `${prop.address_street}, ${prop.address_city}`;

  const MLS_ERRORS: Record<string, string> = {
    invalid_format: "That MLS number doesn't look right (e.g. A11234567).",
    empty: "Enter the MLS number.",
    taken: "That MLS number is already on another listing.",
    failed: "Could not save the MLS number. Try again.",
  };

  async function approve(formData: FormData) {
    "use server";
    // Opcional: si aún no está en Matrix se deja vacío y queda la tarea enter_mls_number.
    const mls = parseMlsNumber(String(formData.get("mls_number") ?? ""));
    if (!mls.ok && mls.reason === "invalid_format") {
      redirect(`/${lang}/admin/listings/${id}/review?error=invalid_format`);
    }
    await transition(lang, id, shortAddress, "active", "listing_approved", null, mls.ok ? mls.value : null);
  }
  async function saveMlsNumber(formData: FormData) {
    "use server";
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) redirect(`/${lang}/sign-in?next=/admin`);
    const [{ data: a }, { data: b }] = await Promise.all([
      supabase.rpc("has_role", { _role: "admin" }),
      supabase.rpc("has_role", { _role: "broker" }),
    ]);
    if (a !== true && b !== true) redirect(`/${lang}/dashboard`);

    const r = await saveListingMlsNumber(supabase, {
      propertyId: id,
      raw: String(formData.get("mls_number") ?? ""),
      userId: user.id,
    });
    redirect(
      r.ok
        ? `/${lang}/admin/listings/${id}/review?done=mls_number_saved`
        : `/${lang}/admin/listings/${id}/review?error=${r.error}`,
    );
  }
  async function reject() {
    "use server";
    await transition(lang, id, shortAddress, "withdrawn", "listing_rejected", null);
  }
  async function requestChanges(formData: FormData) {
    "use server";
    const note = String(formData.get("note") ?? "").slice(0, 1000).trim();
    await transition(lang, id, shortAddress, "draft", "listing_changes_requested", note || null);
  }

  const fullAddress = `${prop.address_street}, ${prop.address_city}, ${prop.address_state} ${prop.address_zip}`;
  const agreementSigned =
    agreement?.status === "signed" || agreement?.status === "completed";

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <Link
          href={`/${lang}/admin/listings`}
          className="text-[10px] uppercase tracking-[0.22em] text-ink/55 hover:text-gold transition-colors"
        >
          ← Listings
        </Link>
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="font-display text-3xl text-ink font-normal">
            {prop.address_street}
          </h1>
          <span className="text-[9px] uppercase tracking-[0.18em] px-2.5 py-1 border border-gold bg-gold/5 text-ink">
            {prop.mls_status.replace("_", " ")}
          </span>
        </div>
        <p className="text-sm text-ink/60">{fullAddress}</p>
      </div>

      {sp.done && (
        <div className="border border-gold bg-gold/5 px-4 py-3 text-sm text-ink">
          Done: {sp.done.replace(/_/g, " ")}.
        </div>
      )}
      {sp.error && MLS_ERRORS[sp.error] && (
        <div className="border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          {MLS_ERRORS[sp.error]} Nothing was changed.
        </div>
      )}

      {/* MLS number — anotado a mano desde Matrix; evita que /properties muestre el
          listing dos veces (fila propia + ficha del feed IDX). */}
      <section className="border border-gold-soft p-6 flex flex-col gap-3">
        <span className="text-[10px] uppercase tracking-[0.18em] text-gold font-semibold">
          MLS number
        </span>
        <p className="text-sm text-ink/80">
          {prop.mls_number ? (
            <>Current: <strong className="font-mono">{prop.mls_number}</strong></>
          ) : (
            <span className="text-ink/55 italic">Not recorded yet.</span>
          )}
        </p>
        <form action={saveMlsNumber} className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-[0.18em] text-ink/55">
              {prop.mls_number ? "Correct it" : "Record it"}
            </span>
            <input
              name="mls_number"
              type="text"
              required
              autoComplete="off"
              spellCheck={false}
              defaultValue={prop.mls_number ?? ""}
              placeholder="A11234567"
              className="w-44 border border-gold-soft bg-ivory px-3 py-2 text-sm text-ink uppercase font-mono focus:outline-none focus:border-gold"
            />
          </label>
          <button
            type="submit"
            className="inline-flex items-center px-6 py-3 border border-gold-soft text-ink text-[10px] font-medium tracking-[0.22em] uppercase hover:border-gold transition-colors"
          >
            Save MLS number
          </button>
        </form>
        <p className="text-xs text-ink/55">
          Enter it after the listing is live in Matrix. Saving it closes the
          &ldquo;Enter MLS number&rdquo; task.
        </p>
      </section>

      {/* Listing data */}
      <section className="border border-gold-soft p-6 grid grid-cols-2 md:grid-cols-4 gap-5">
        {field("Type", prop.property_type)}
        {field(
          "Beds / Baths",
          `${prop.bedrooms ?? "—"} / ${prop.bathrooms ?? "—"}`,
        )}
        {field("Sqft", prop.sqft ? prop.sqft.toLocaleString() : null)}
        {field("Year built", prop.year_built)}
        {field(
          "List price",
          prop.list_price ? `$${prop.list_price.toLocaleString()}` : null,
        )}
        {field(
          "Tier",
          prop.pricing_tier
            ? prop.pricing_tier.charAt(0).toUpperCase() +
                prop.pricing_tier.slice(1)
            : null,
        )}
        {field(
          "Buyer-agent %",
          prop.buyer_agent_commission != null
            ? `${prop.buyer_agent_commission}%`
            : null,
        )}
        {field("Lot size", prop.lot_size)}
      </section>

      {(prop.description || prop.showing_instructions || prop.legal_description) && (
        <section className="border border-gold-soft p-6 flex flex-col gap-4">
          {prop.description && (
            <div className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-[0.18em] text-ink/55">
                Description
              </span>
              <p className="text-sm text-ink/80 leading-relaxed">
                {prop.description}
              </p>
            </div>
          )}
          {prop.showing_instructions && (
            <div className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-[0.18em] text-ink/55">
                Showing instructions
              </span>
              <p className="text-sm text-ink/80 leading-relaxed">
                {prop.showing_instructions}
              </p>
            </div>
          )}
          {prop.legal_description && (
            <div className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-[0.18em] text-ink/55">
                Legal description
              </span>
              <p className="text-sm text-ink/80 leading-relaxed whitespace-pre-line">
                {prop.legal_description}
              </p>
            </div>
          )}
        </section>
      )}

      {/* Occupancy */}
      <section className="border border-gold-soft p-6 grid grid-cols-2 md:grid-cols-4 gap-5">
        {field("Occupancy", prop.occupancy_status?.replace("_", " "))}
        {prop.occupancy_status === "tenant_occupied" && (
          <>
            {field(
              "Monthly rent",
              prop.monthly_rent ? `$${prop.monthly_rent.toLocaleString()}` : null,
            )}
            {field("Lease end", prop.lease_end_date)}
            {field("Tenant", prop.tenant_cooperation?.replace("_", " "))}
            {prop.tenant_notes && field("Tenant notes", prop.tenant_notes)}
          </>
        )}
      </section>

      {/* Photos */}
      <section className="flex flex-col gap-4">
        <h2 className="font-display text-xl text-ink">
          Photos ({photos.length})
        </h2>
        {photos.length === 0 ? (
          <p className="text-sm text-ink/55 italic">No photos uploaded.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {photos.map((ph) => (
              <div
                key={ph.id}
                className="relative aspect-[4/3] border border-gold-soft bg-ivory-strong/40 overflow-hidden"
              >
                <Image
                  src={ph.url}
                  alt=""
                  fill
                  sizes="(min-width:1024px) 25vw, 50vw"
                  className="object-cover"
                  unoptimized
                />
                {ph.is_primary && (
                  <span className="absolute top-1 left-1 text-[8px] uppercase tracking-[0.18em] bg-gold text-ivory px-1.5 py-0.5">
                    Primary
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Listing agreement */}
      <section className="border border-gold-soft p-6 flex flex-col gap-2">
        <span className="text-[10px] uppercase tracking-[0.18em] text-gold font-semibold">
          Listing agreement
        </span>
        {agreement ? (
          <p className="text-sm text-ink/80">
            Status: <strong>{agreement.status}</strong>
            {agreement.signer_name ? ` · ${agreement.signer_name}` : ""}
            {agreement.signed_at
              ? ` · signed ${new Date(agreement.signed_at).toLocaleDateString(lang)}`
              : ""}
          </p>
        ) : (
          <p className="text-sm text-ink/55 italic">
            No listing agreement on file yet.
          </p>
        )}
        {!agreementSigned && (
          <p className="text-xs text-amber-700">
            ⚠️ Seller hasn&apos;t completed the listing agreement. Approving is
            not advisable until it&apos;s signed.
          </p>
        )}
      </section>

      {/* Broker actions */}
      <section className="border-t-2 border-gold-soft pt-6 flex flex-wrap items-center gap-4">
        <form action={approve} className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-[0.18em] text-ink/55">
              MLS number (optional)
            </span>
            <input
              name="mls_number"
              type="text"
              autoComplete="off"
              spellCheck={false}
              placeholder="A11234567"
              className="w-40 border border-gold-soft bg-ivory px-3 py-2 text-sm text-ink uppercase font-mono focus:outline-none focus:border-gold"
            />
          </label>
          <button
            type="submit"
            className="inline-flex items-center px-6 py-3 bg-ink text-ivory text-[10px] font-medium tracking-[0.22em] uppercase hover:bg-ink/85 transition-colors"
          >
            Approve → Active
          </button>
        </form>
        <form action={reject}>
          <button
            type="submit"
            className="inline-flex items-center px-6 py-3 border border-red-300 text-red-800 text-[10px] font-medium tracking-[0.22em] uppercase hover:bg-red-50 transition-colors"
          >
            Reject (withdraw)
          </button>
        </form>
        <details className="w-full">
          <summary className="cursor-pointer text-[10px] uppercase tracking-[0.22em] text-ink/60 hover:text-gold">
            Request changes →
          </summary>
          <form action={requestChanges} className="flex flex-col gap-3 mt-3 max-w-xl">
            <textarea
              name="note"
              rows={3}
              required
              placeholder="What needs to change before this can be approved?"
              className="border border-gold-soft bg-ivory px-3 py-2 text-sm text-ink focus:outline-none focus:border-gold"
            />
            <button
              type="submit"
              className="self-start inline-flex items-center px-6 py-3 border border-gold-soft text-ink text-[10px] font-medium tracking-[0.22em] uppercase hover:border-gold transition-colors"
            >
              Send back to seller (draft)
            </button>
          </form>
        </details>
      </section>
    </div>
  );
}
