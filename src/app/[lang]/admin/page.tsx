import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { isLocale, t } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { SuccessBanner, ErrorBanner } from "@/components/auth-shell";
import { sendListingApproved } from "@/lib/email";

interface PendingListing {
  id: string;
  address_street: string;
  address_city: string;
  address_state: string;
  address_zip: string;
  bedrooms: number;
  bathrooms: number;
  sqft: number;
  list_price: number;
  pricing_tier: string | null;
  owner_id: string;
  updated_at: string | null;
  created_at: string;
}

interface PaymentRowJoined {
  id: string;
  amount: number;
  currency: string;
  status: string;
  payment_type: string;
  tier: string | null;
  created_at: string;
  property_id: string;
  user_id: string;
}

export default async function AdminPage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{ approved?: string; error?: string }>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const sp = await searchParams;

  const copy = t(lang).admin;

  const supabase = await createClient();

  // Pending approval queue: properties with mls_status='pending_approval'.
  const { data: pendingRows } = await supabase
    .from("properties")
    .select(
      "id,address_street,address_city,address_state,address_zip,bedrooms,bathrooms,sqft,list_price,pricing_tier,owner_id,updated_at,created_at",
    )
    .eq("mls_status", "pending_approval")
    .order("updated_at", { ascending: true });
  const pending = (pendingRows ?? []) as PendingListing[];

  // Owner names (Lovable users table).
  const ownerIds = Array.from(new Set(pending.map((p) => p.owner_id)));
  const ownerNameById = new Map<string, string>();
  if (ownerIds.length > 0) {
    const { data: owners } = await supabase
      .from("users")
      .select("id,first_name,last_name,email")
      .in("id", ownerIds);
    for (const o of (owners ?? []) as Array<{
      id: string;
      first_name: string | null;
      last_name: string | null;
      email: string | null;
    }>) {
      const name = [o.first_name, o.last_name].filter(Boolean).join(" ").trim();
      ownerNameById.set(o.id, name || o.email || o.id.slice(0, 8));
    }
  }

  // Recent payments — 20 most recent succeeded/pending across the platform.
  const { data: payRows } = await supabase
    .from("payments")
    .select(
      "id,amount,currency,status,payment_type,tier,created_at,property_id,user_id",
    )
    .order("created_at", { ascending: false })
    .limit(20);
  const payments = (payRows ?? []) as PaymentRowJoined[];

  async function approveListing(formData: FormData) {
    "use server";
    const id = String(formData.get("id") ?? "");
    if (!id) redirect(`/${lang}/admin?error=missing_id`);

    const supabase = await createClient();
    const admin = await supabase.rpc("has_role", { _role: "admin" });
    if (admin.error || admin.data !== true) {
      redirect(`/${lang}/admin?error=not_authorized`);
    }

    const { data: prop, error } = await supabase
      .from("properties")
      .update({ mls_status: "active" })
      .eq("id", id)
      .eq("mls_status", "pending_approval")
      .select(
        "id,address_street,address_city,address_state,address_zip,owner_id",
      )
      .maybeSingle();
    if (error || !prop) {
      redirect(`/${lang}/admin?error=approve_failed`);
    }

    // Notify seller (best-effort).
    try {
      const { data: sellerAuth } = await supabase.auth.admin.getUserById(
        prop.owner_id,
      );
      const sellerEmail = sellerAuth.user?.email;
      if (sellerEmail) {
        const origin =
          process.env.NEXT_PUBLIC_SITE_URL ?? "https://lixtara.vercel.app";
        await sendListingApproved({
          to: sellerEmail,
          propertyAddress: `${prop.address_street}, ${prop.address_city}, ${prop.address_state} ${prop.address_zip}`,
          listingUrl: `${origin}/${lang}/property/${prop.id}`,
        });
      }
    } catch (e) {
      console.error("admin approve email failed:", e);
    }

    redirect(`/${lang}/admin?approved=${id}`);
  }

  return (
    <div className="flex flex-col">
      <section className="mx-auto w-full max-w-7xl px-6 lg:px-12 pt-12 pb-20 lg:pt-16 lg:pb-28">
        <div className="flex flex-col gap-3 mb-10 lg:mb-14">
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-gold">
            {copy.eyebrow}
          </p>
          <h1 className="font-display text-3xl md:text-4xl lg:text-5xl leading-[1.1] tracking-tight text-ink font-normal max-w-3xl">
            {copy.titleBefore}
            <em className="italic text-gold">{copy.titleAccent}</em>
            {copy.titleAfter}
          </h1>
          <p className="text-base leading-relaxed text-ink/70 max-w-2xl">
            {copy.body}
          </p>
        </div>

        {sp.approved && (
          <div className="mb-8">
            <SuccessBanner message={copy.approvedNote} />
          </div>
        )}
        {sp.error === "approve_failed" && (
          <div className="mb-8">
            <ErrorBanner message={copy.approveFailed} />
          </div>
        )}

        {/* Pending approval queue */}
        <div className="mb-16 lg:mb-20">
          <h2 className="font-display text-2xl text-ink mb-6 border-b border-gold-soft pb-3">
            {copy.pendingListingsHeader}
            {pending.length > 0 && (
              <span className="ml-3 text-base text-gold align-middle">
                ({pending.length})
              </span>
            )}
          </h2>

          {pending.length === 0 ? (
            <div className="border border-gold-soft bg-ivory-strong/40 p-8 lg:p-10 flex flex-col gap-3 max-w-2xl">
              <p className="font-display text-xl text-ink">
                {copy.emptyPendingTitle}
              </p>
              <p className="text-sm text-ink/70 leading-relaxed">
                {copy.emptyPendingBody}
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {pending.map((p) => {
                const tierName = p.pricing_tier
                  ? p.pricing_tier.charAt(0).toUpperCase() +
                    p.pricing_tier.slice(1)
                  : "—";
                const ownerName = ownerNameById.get(p.owner_id) ?? "—";
                const submitted = p.updated_at ?? p.created_at;
                return (
                  <div
                    key={p.id}
                    className="border border-gold-soft bg-ivory p-5 lg:p-6 grid grid-cols-1 lg:grid-cols-12 gap-5 lg:gap-6 items-start"
                  >
                    <div className="lg:col-span-5 flex flex-col gap-1">
                      <p className="text-[10px] uppercase tracking-[0.18em] text-ink/55">
                        {copy.addressLabel}
                      </p>
                      <p className="font-display text-base text-ink leading-tight">
                        {p.address_street}
                      </p>
                      <p className="text-xs text-ink/60">
                        {p.address_city}, {p.address_state} {p.address_zip}
                      </p>
                      <p className="text-[10px] uppercase tracking-[0.18em] text-ink/55 mt-2">
                        {copy.sellerLabel}
                      </p>
                      <p className="text-sm text-ink">{ownerName}</p>
                    </div>

                    <div className="lg:col-span-3 flex flex-col gap-2">
                      <div className="flex flex-col gap-0.5">
                        <p className="text-[10px] uppercase tracking-[0.18em] text-ink/55">
                          {copy.tierLabel}
                        </p>
                        <p className="text-sm text-ink">{tierName}</p>
                      </div>
                      <div className="flex flex-col gap-0.5">
                        <p className="text-[10px] uppercase tracking-[0.18em] text-ink/55">
                          {copy.priceLabel}
                        </p>
                        <p className="font-display italic text-lg text-ink">
                          <span className="text-gold text-sm align-top">$</span>
                          {p.list_price.toLocaleString()}
                        </p>
                      </div>
                      <div className="flex flex-col gap-0.5">
                        <p className="text-[10px] uppercase tracking-[0.18em] text-ink/55">
                          {copy.detailsLabel}
                        </p>
                        <p className="text-sm text-ink">
                          {p.bedrooms} / {p.bathrooms} / {p.sqft.toLocaleString()}
                        </p>
                      </div>
                    </div>

                    <div className="lg:col-span-4 flex flex-col gap-3 items-start lg:items-end">
                      <div className="flex flex-col gap-0.5 lg:items-end">
                        <p className="text-[10px] uppercase tracking-[0.18em] text-ink/55">
                          {copy.submittedLabel}
                        </p>
                        <p className="text-xs text-ink/70">
                          {new Date(submitted).toLocaleDateString(lang, {
                            year: "numeric",
                            month: "short",
                            day: "numeric",
                          })}
                        </p>
                      </div>
                      <Link
                        href={`/${lang}/property/${p.id}`}
                        target="_blank"
                        className="text-[10px] uppercase tracking-[0.22em] text-ink/55 hover:text-gold transition-colors"
                      >
                        Preview public page →
                      </Link>
                      <form action={approveListing}>
                        <input type="hidden" name="id" value={p.id} />
                        <button
                          type="submit"
                          className="inline-flex items-center px-6 py-3 bg-ink text-ivory text-[10px] font-medium tracking-[0.22em] uppercase hover:bg-ink/85 transition-colors"
                        >
                          {copy.approveButton}
                        </button>
                      </form>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Recent payments */}
        <div>
          <h2 className="font-display text-2xl text-ink mb-6 border-b border-gold-soft pb-3">
            {copy.recentPaymentsHeader}
          </h2>

          {payments.length === 0 ? (
            <p className="text-sm text-ink/60 italic">{copy.noPayments}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-[0.18em] text-ink/55 border-b border-gold-soft">
                    <th className="py-3 pr-4">{copy.paymentDate}</th>
                    <th className="py-3 pr-4">{copy.paymentAmount}</th>
                    <th className="py-3 pr-4">{copy.paymentStatus}</th>
                    <th className="py-3 pr-4">{copy.paymentTier}</th>
                    <th className="py-3">{copy.paymentProperty}</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((p) => (
                    <tr
                      key={p.id}
                      className="border-b border-gold-soft/50"
                    >
                      <td className="py-3 pr-4 text-ink/70 text-xs whitespace-nowrap">
                        {new Date(p.created_at).toLocaleDateString(lang, {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                        })}
                      </td>
                      <td className="py-3 pr-4 font-display text-base text-ink whitespace-nowrap">
                        <span className="text-gold text-xs align-top">$</span>
                        {p.amount.toLocaleString()}
                        <span className="text-[10px] uppercase tracking-[0.18em] text-ink/55 ml-1 font-sans not-italic">
                          {p.currency}
                        </span>
                      </td>
                      <td className="py-3 pr-4">
                        <span
                          className={`inline-block text-[9px] uppercase tracking-[0.18em] px-2.5 py-1 border ${
                            p.status === "succeeded"
                              ? "border-gold bg-gold/5 text-ink"
                              : p.status === "failed" ||
                                  p.status === "refunded"
                                ? "border-red-300 bg-red-50 text-red-800"
                                : "border-gold-soft bg-ivory-strong/40 text-ink/70"
                          }`}
                        >
                          {p.status}
                        </span>
                      </td>
                      <td className="py-3 pr-4 text-ink/70 text-xs">
                        {p.tier
                          ? p.tier.charAt(0).toUpperCase() + p.tier.slice(1)
                          : "—"}
                      </td>
                      <td className="py-3 text-xs">
                        <Link
                          href={`/${lang}/property/${p.property_id}`}
                          className="text-gold hover:text-ink transition-colors font-mono"
                        >
                          {p.property_id.slice(0, 8)}…
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
