import Link from "next/link";
import Image from "next/image";
import { notFound, redirect } from "next/navigation";
import { isLocale } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";

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

export default async function ListingReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string; id: string }>;
  searchParams: Promise<{ done?: string }>;
}) {
  const { lang, id } = await params;
  if (!isLocale(lang)) notFound();
  const sp = await searchParams;

  const supabase = await createClient();
  const { data: property } = await supabase
    .from("properties")
    .select(
      "id,owner_id,address_street,address_city,address_state,address_zip,property_type,bedrooms,bathrooms,sqft,year_built,lot_size,list_price,mls_status,pricing_tier,description,showing_instructions,occupancy_status,monthly_rent,lease_end_date,tenant_cooperation,tenant_notes,legal_description,buyer_agent_commission",
    )
    .eq("id", id)
    .maybeSingle();
  if (!property) notFound();
  const prop = property as Property;

  const [{ data: photoRows }, { data: agreementRow }] = await Promise.all([
    supabase
      .from("property_photos")
      .select("id,url,is_primary,display_order")
      .eq("property_id", id)
      .order("display_order", { ascending: true }),
    supabase
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
  async function transition(
    newStatus: string,
    actionType: string,
    note: string | null,
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

    await supabase
      .from("properties")
      .update({ mls_status: newStatus })
      .eq("id", id);

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

  async function approve() {
    "use server";
    await transition("active", "listing_approved", null);
  }
  async function reject() {
    "use server";
    await transition("withdrawn", "listing_rejected", null);
  }
  async function requestChanges(formData: FormData) {
    "use server";
    const note = String(formData.get("note") ?? "").slice(0, 1000).trim();
    await transition("draft", "listing_changes_requested", note || null);
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
            ⚠️ Seller hasn&apos;t completed the listing agreement — approving is
            not advisable until it&apos;s signed.
          </p>
        )}
      </section>

      {/* Broker actions */}
      <section className="border-t-2 border-gold-soft pt-6 flex flex-wrap items-center gap-4">
        <form action={approve}>
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
