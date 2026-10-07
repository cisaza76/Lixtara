import { notFound, redirect } from "next/navigation";
import { isLocale, type Locale } from "@/lib/i18n";
import { requireAdminOrBroker } from "@/lib/admin-auth";
import { createClient } from "@/lib/supabase/server";
import { sendResumeLink } from "@/lib/listing-email-gate.server";

// Sellers who confirmed their email at step 1 of the listing flow. If one of
// them stops answering mid-listing, the broker sends a magic link that signs
// them in and drops them back on the step where they left off.

interface LeadRow {
  user_id: string;
  email: string;
  locale: "en" | "es";
  status: string;
  current_step: number | null;
  last_step_at: string | null;
  property_id: string | null;
  properties: { address_street: string; address_city: string; mls_status: string } | null;
}

const STEP_NAMES = ["Address", "Plan", "Details", "Description", "Photos", "Review", "Agreement", "Payment"];

export default async function AdminSellerLeadsPage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{ sent?: string; error?: string }>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const sp = await searchParams;

  async function sendLink(formData: FormData) {
    "use server";
    if (!isLocale(lang)) return;
    // Server actions are callable on their own: re-check the role here.
    await requireAdminOrBroker(lang as Locale);
    const userId = String(formData.get("user_id") ?? "");
    if (!userId) redirect(`/${lang}/admin/seller-leads?error=1`);
    const result = await sendResumeLink({ userId });
    redirect(`/${lang}/admin/seller-leads?${result === "sent" ? "sent=1" : "error=1"}`);
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("seller_leads")
    .select(
      "user_id,email,locale,status,current_step,last_step_at,property_id,properties(address_street,address_city,mls_status)",
    )
    .order("last_step_at", { ascending: false, nullsFirst: false })
    .limit(200);
  const leads = (data ?? []) as unknown as LeadRow[];

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-3xl text-ink font-normal">Seller Leads</h1>
        <p className="text-sm text-ink/60 max-w-2xl">
          Sellers who confirmed their email when they started a listing. Use
          &ldquo;Send continue link&rdquo; when one stops at a step: they get an
          email with a link that signs them in and opens their draft where they
          left off.
        </p>
      </div>

      {sp.sent === "1" && (
        <p className="border border-green-300 bg-green-50 px-4 py-2.5 text-sm text-green-800">
          Link sent.
        </p>
      )}
      {(sp.error === "1" || error) && (
        <p className="border border-red-300 bg-red-50 px-4 py-2.5 text-sm text-red-800">
          {error ? "Could not load seller leads." : "The link could not be sent. Check the logs."}
        </p>
      )}

      {leads.length === 0 ? (
        <p className="text-sm text-ink/55 italic">No seller leads yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-[0.18em] text-ink/55 border-b border-gold-soft">
                <th className="py-3 pr-4">Email</th>
                <th className="py-3 pr-4">Property</th>
                <th className="py-3 pr-4">Last step</th>
                <th className="py-3 pr-4">Last activity</th>
                <th className="py-3" />
              </tr>
            </thead>
            <tbody>
              {leads.map((l) => {
                const stillDraft = !l.properties || l.properties.mls_status === "draft";
                return (
                  <tr key={l.user_id} className="border-b border-gold-soft/50">
                    <td className="py-3 pr-4 text-ink">
                      {l.email}
                      <span className="block text-xs text-ink/50 uppercase">{l.locale}</span>
                    </td>
                    <td className="py-3 pr-4 text-ink/80">
                      {l.properties ? (
                        <>
                          {l.properties.address_street}
                          <span className="block text-xs text-ink/55">
                            {l.properties.address_city} · {l.properties.mls_status.replace("_", " ")}
                          </span>
                        </>
                      ) : (
                        <span className="text-ink/45">No draft</span>
                      )}
                    </td>
                    <td className="py-3 pr-4 text-xs text-ink/70 whitespace-nowrap">
                      {l.current_step
                        ? `${l.current_step}. ${STEP_NAMES[l.current_step - 1] ?? ""}`
                        : "Not started"}
                    </td>
                    <td className="py-3 pr-4 text-xs text-ink/70 whitespace-nowrap">
                      {l.last_step_at ? new Date(l.last_step_at).toLocaleString("en-US") : "Never"}
                    </td>
                    <td className="py-3">
                      {stillDraft && (
                        <form action={sendLink}>
                          <input type="hidden" name="user_id" value={l.user_id} />
                          <button
                            type="submit"
                            className="text-[10px] uppercase tracking-[0.22em] text-gold hover:text-ink transition-colors whitespace-nowrap"
                          >
                            Send continue link
                          </button>
                        </form>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
