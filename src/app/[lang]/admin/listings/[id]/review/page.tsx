import Link from "next/link";
import { compensationAgreementsFor, formatOffer, offerFromRow } from "@/lib/buyer-comp";
import { fetchBuyerComp } from "@/lib/buyer-comp.server";
import Image from "next/image";
import { notFound, redirect } from "next/navigation";
import { isLocale } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { createService } from "@/lib/supabase/service";
import { assertStaffWithUser } from "@/lib/admin-auth";
import {
  checkBrokerCountersigned,
  isFinalAgreementStatus,
  refreshAgreement,
  type AgreementRef,
} from "@/lib/agreement-refresh";
import { parseMlsNumber } from "@/lib/listing-mls-number";
import { recordServerEvent } from "@/lib/analytics.server";
import {
  ensureEnterMlsNumberTask,
  mapMlsNumberWriteError,
  saveListingMlsNumber,
} from "@/lib/listing-mls-number.server";
import { describeChanges, type ChangeSet } from "@/lib/listing-requests";
import {
  MIN_CORRECTION_NOTE,
  formatMiamiDateTime,
  isPlanPaymentSucceeded,
  markPublishedBlockers,
  correctedPublishedAt,
  refundOnCancel,
  toMiamiDateTimeInput,
} from "@/lib/mls-published";
import { correctListingMlsPublished, markListingMlsPublished } from "@/lib/mls-published.server";
import { MarkPublishedForm } from "@/components/admin/mark-published-form";
import { CASSB1_ENABLED } from "@/lib/buyer-comp";
import { pendingLegalByProperty } from "@/lib/agreement-legal.server";
import { legalPendingHint, legalPendingMessage } from "@/lib/agreement-legal";
import { approveListingRequest, rejectListingRequest } from "@/lib/listing-requests.server";
import {
  TEST_LISTING_ERROR,
  isTestListing,
  notifyListingApprovedOnce,
  testListingMessage,
  writeListingStatus,
} from "@/lib/listing-approval.server";

interface Property {
  id: string;
  owner_id: string;
  /** Listing de prueba: no se puede aprobar. */
  is_test: boolean;
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
  mls_published_at: string | null;
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
  buyer_agent_comp_type: string | null;
  buyer_agent_comp_amount: number | null;
}

interface SellerRequest {
  id: string;
  kind: "change" | "withdrawal";
  changes: ChangeSet;
  reason: string | null;
  created_at: string;
}

interface Photo {
  id: string;
  url: string;
  is_primary: boolean | null;
  display_order: number | null;
}

interface PublishedHistoryRow {
  old_published_at: string | null;
  new_published_at: string | null;
  changed_by: string;
  changed_at: string;
  note: string | null;
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

  // El vendedor paga al firmar, pero el listing no se publica sin la contrafirma de la
  // broker en DocuSign (se consulta en vivo; si DocuSign no responde, no se publica).
  if (newStatus === "active") {
    // Un listing de prueba no se aprueba: publicarlo mandaría el correo de aprobación.
    if (await isTestListing(supabase, id)) {
      redirect(`/${lang}/admin/listings/${id}/review?error=${TEST_LISTING_ERROR}`);
    }
    // Acuerdo enviado sin descripción legal verificada: no se publica (#217).
    if ((await pendingLegalByProperty([id])).has(id)) {
      redirect(`/${lang}/admin/listings/${id}/review?error=legal_pending`);
    }
    const gate = await checkBrokerCountersigned(id);
    if (!gate.ok) redirect(`/${lang}/admin/listings/${id}/review?error=${gate.reason}`);
  }

  const { error: updateError, becameActive } = await writeListingStatus(supabase, id, newStatus, mlsNumber);
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

  if (newStatus === "active") {
    recordServerEvent({ event: "listing_published", props: {} });
  }
  // El mismo correo que la aprobación desde el inicio del admin, una sola vez por listing.
  if (becameActive) await notifyListingApprovedOnce(id);

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
      "id,owner_id,address_street,address_city,address_state,address_zip,property_type,bedrooms,bathrooms,sqft,year_built,lot_size,list_price,mls_status,mls_number,mls_published_at,pricing_tier,description,showing_instructions,occupancy_status,monthly_rent,lease_end_date,tenant_cooperation,tenant_notes,legal_description,is_test",
    )
    .eq("id", id)
    .maybeSingle();
  if (!property) notFound();
  // La oferta no viene en el select: la tabla no expone esas columnas a la API.
  const prop = { ...(property as Property), ...(await fetchBuyerComp(supabase, id)) } as Property;

  // property_photos and agreements have no admin/broker SELECT policy (only the
  // owner, and the public for ACTIVE listings' photos), so with the session
  // client the review page always showed "no photos" and "no agreement on
  // file" for drafts. Re-check the role here (page data loads in parallel with
  // the admin layout's guard), then read both with the secret key.
  await assertStaffWithUser(lang);
  const svc = createService();
  const [{ data: photoRows }, { data: agreementRow }, { data: paymentRows }] = await Promise.all([
    svc
      .from("property_photos")
      .select("id,url,is_primary,display_order")
      .eq("property_id", id)
      .order("display_order", { ascending: true }),
    svc
      .from("agreements")
      .select("id,envelope_id,property_id,status,signer_name,signer_email,signed_at")
      .eq("property_id", id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    svc.from("payments").select("payment_type,tier,status").eq("property_id", id),
  ]);
  const photos = (photoRows ?? []) as Photo[];

  // Solicitudes pendientes del vendedor (#134, #136): se aplican solo al aprobarlas aquí.
  const { data: requestRows } = await supabase
    .from("listing_requests")
    .select("id,kind,changes,reason,created_at")
    .eq("property_id", id)
    .eq("status", "pending")
    .order("created_at", { ascending: true });
  const sellerRequests = (requestRows ?? []) as SellerRequest[];

  // Publicación en el MLS: quién y cuándo (property_status_history, legible por el staff).
  const [{ data: historyRows }, { data: isAdminRole }] = await Promise.all([
    supabase
      .from("property_status_history")
      .select("old_published_at,new_published_at,changed_by,changed_at,note")
      .eq("property_id", id)
      .order("changed_at", { ascending: false })
      .limit(50),
    supabase.rpc("has_role", { _role: "admin" }),
  ]);
  const publishedHistory = ((historyRows ?? []) as PublishedHistoryRow[]).filter(
    (h) => h.old_published_at !== h.new_published_at,
  );
  const actorIds = [...new Set(publishedHistory.map((h) => h.changed_by))].filter((v) =>
    /^[0-9a-f-]{36}$/.test(v),
  );
  const { data: actorRows } = actorIds.length
    ? await svc.from("users").select("id,first_name,last_name,email").in("id", actorIds)
    : { data: [] };
  const actorName = new Map(
    ((actorRows ?? []) as { id: string; first_name: string | null; last_name: string | null; email: string | null }[]).map(
      (u) => [u.id, [u.first_name, u.last_name].filter(Boolean).join(" ") || u.email || u.id],
    ),
  );
  const agreement = (agreementRow ?? null) as (Agreement & AgreementRef) | null;
  // Live status: the stored one lags until the seller's page or a DocuSign
  // webhook refreshes it, so refresh it here too.
  if (agreement && !isFinalAgreementStatus(agreement.status)) {
    const live = await refreshAgreement(agreement);
    if (live !== agreement.status) {
      agreement.status = live as Agreement["status"];
      if (live === "signed" || live === "completed") agreement.signed_at ??= new Date().toISOString();
    }
  }

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
    matrix_required: "Confirm you already made this change in Matrix.",
    not_pending: "That request was already handled.",
    apply_failed: "Could not apply the request to the listing. Try again.",
    not_countersigned: "The broker hasn't countersigned the listing agreement in DocuSign yet.",
    legal_pending: legalPendingMessage(lang),
    [TEST_LISTING_ERROR]: testListingMessage(lang),
    docusign_unavailable: "Could not confirm the broker's countersignature with DocuSign. Try again.",
    listing_not_active: "Approve the listing (active) before marking it as published on the MLS.",
    already_published: "This listing already has an MLS publication date. Only an admin can correct it.",
    mls_number_required: "Enter the MLS number to mark the listing as published.",
    agreement_not_completed: "The listing agreement isn't completed (signed by the seller and countersigned) yet.",
    payment_not_succeeded: "The plan payment hasn't succeeded yet.",
    future_date: "The publication date can't be in the future.",
    admin_only: "Only an admin can correct the publication date.",
    note_required: `Write a note of at least ${MIN_CORRECTION_NOTE} characters explaining the correction.`,
    invalid_date: "That date doesn't look right.",
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
  async function markPublished(formData: FormData) {
    "use server";
    const { sb, userId } = await assertStaffWithUser(lang);
    const r = await markListingMlsPublished(sb, {
      propertyId: id,
      rawMlsNumber: String(formData.get("mls_number") ?? ""),
      userId,
    });
    redirect(
      r.ok
        ? `/${lang}/admin/listings/${id}/review?done=mls_published_marked`
        : `/${lang}/admin/listings/${id}/review?error=${r.error}`,
    );
  }
  // Corrección: solo admin (la base lo exige también), con nota y rastro.
  async function correctPublished(formData: FormData) {
    "use server";
    const { sb, userId } = await assertStaffWithUser(lang);
    const clear = formData.get("clear") === "1";
    // Fecha actual desde la base, no del formulario: si el selector no se tocó, se conserva.
    const { data: current } = await sb.from("properties").select("mls_published_at").eq("id", id).maybeSingle();
    const publishedAt = clear
      ? null
      : correctedPublishedAt(
          String(formData.get("published_at") ?? ""),
          (current as { mls_published_at: string | null } | null)?.mls_published_at ?? null,
        );
    if (!clear && !publishedAt) redirect(`/${lang}/admin/listings/${id}/review?error=invalid_date`);
    const r = await correctListingMlsPublished(sb, {
      propertyId: id,
      publishedAt,
      note: String(formData.get("note") ?? ""),
      userId,
    });
    redirect(
      r.ok
        ? `/${lang}/admin/listings/${id}/review?done=mls_published_corrected`
        : `/${lang}/admin/listings/${id}/review?error=${r.error}`,
    );
  }
  // Solicitud del vendedor: Matrix primero, luego aprobar (se aplica) o rechazar (#134, #136).
  async function reviewSellerRequest(formData: FormData) {
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

    const requestId = String(formData.get("request_id") ?? "");
    const decision = String(formData.get("decision") ?? "");
    const note = String(formData.get("note") ?? "").slice(0, 2000).trim() || null;
    if (!requestId || (decision !== "approve" && decision !== "reject")) {
      redirect(`/${lang}/admin/listings/${id}/review`);
    }
    if (decision === "approve" && formData.get("matrix_done") !== "1") {
      redirect(`/${lang}/admin/listings/${id}/review?error=matrix_required`);
    }
    const args = { requestId, propertyId: id, reviewerId: user.id, note };
    const r =
      decision === "approve"
        ? await approveListingRequest(supabase, args)
        : await rejectListingRequest(supabase, args);
    redirect(
      r.ok
        ? `/${lang}/admin/listings/${id}/review?done=seller_request_${decision === "approve" ? "approved" : "rejected"}`
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
  const awaitingCountersign = agreement?.status === "signed";
  const legalPending = (await pendingLegalByProperty([id])).has(id);
  const planPaid = isPlanPaymentSucceeded(
    (paymentRows ?? []) as { payment_type: string | null; tier: string | null; status: string | null }[],
  );
  const publishBlockers = markPublishedBlockers({
    publishedAt: prop.mls_published_at,
    mlsStatus: prop.mls_status,
    mlsNumber: prop.mls_number,
    agreementStatus: agreement?.status ?? null,
    planPaymentSucceeded: planPaid,
  });

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

      {sellerRequests.length > 0 && (
        <section className="border border-gold bg-gold/5 p-6 flex flex-col gap-5">
          <span className="text-[10px] uppercase tracking-[0.18em] text-gold font-semibold">
            Seller requests ({sellerRequests.length})
          </span>
          <p className="text-sm text-ink/75">
            Make the change in Matrix first. Approving applies it on lixtara.com; nothing is
            published before that.
          </p>
          {sellerRequests.map((r) => (
            <form
              key={r.id}
              action={reviewSellerRequest}
              className="border-t border-gold-soft pt-4 flex flex-col gap-3"
            >
              <input type="hidden" name="request_id" value={r.id} />
              <p className="text-sm text-ink">
                <strong>{r.kind === "change" ? "Change" : "Withdrawal"}</strong>
                <span className="text-ink/55"> · {new Date(r.created_at).toLocaleDateString("en-US")}</span>
              </p>
              {r.kind === "change" ? (
                <p className="text-sm text-ink/80 font-mono break-words">{describeChanges(r.changes)}</p>
              ) : (
                <p className="text-sm text-ink/80">Take this listing off the market (→ withdrawn).</p>
              )}
              {r.reason && <p className="text-sm text-ink/70 italic">“{r.reason}”</p>}
              <label className="flex items-center gap-2 text-sm text-ink">
                <input type="checkbox" name="matrix_done" value="1" />
                {r.kind === "change" ? "Already updated in Matrix" : "Already withdrawn in Matrix"}
              </label>
              <textarea
                name="note"
                rows={2}
                maxLength={2000}
                placeholder="Note to the seller (optional)"
                className="w-full border border-gold-soft bg-ivory px-3 py-2 text-sm text-ink"
              />
              <div className="flex gap-3">
                <button
                  type="submit"
                  name="decision"
                  value="approve"
                  className="inline-flex items-center px-5 py-2.5 bg-ink text-ivory text-[10px] font-medium tracking-[0.22em] uppercase hover:bg-ink/85 transition-colors"
                >
                  Approve &amp; apply
                </button>
                <button
                  type="submit"
                  name="decision"
                  value="reject"
                  className="inline-flex items-center px-5 py-2.5 border border-gold-soft text-ink text-[10px] font-medium tracking-[0.22em] uppercase hover:border-gold transition-colors"
                >
                  Reject
                </button>
              </div>
            </form>
          ))}
        </section>
      )}

      {/* Publicación en el MLS: prueba de devengo de la tarifa fija. Sin fecha, si el vendedor
          cancela corresponde reembolso total (legal-terms.ts#refundPolicy). */}
      <section className="border border-gold-soft p-6 flex flex-col gap-4">
        <span className="text-[10px] uppercase tracking-[0.18em] text-gold font-semibold">
          MLS publication
        </span>
        {prop.mls_published_at ? (
          <div className="flex flex-col gap-1 text-sm text-ink/80">
            <p>
              Published on the MLS:{" "}
              <strong>{formatMiamiDateTime(prop.mls_published_at)}</strong>
              {prop.mls_number ? (
                <>
                  {" "}· MLS # <strong className="font-mono">{prop.mls_number}</strong>
                </>
              ) : null}
            </p>
            <p className="text-xs text-ink/60">
              The flat fee is earned: if the seller cancels now, it is not refunded (except a
              double charge or a technical error).
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-ink/80">
              Not marked as published.{" "}
              <span className="text-ink/60">
                {refundOnCancel(prop.mls_published_at) === "full"
                  ? "If the seller cancels now, the flat fee is refunded in full."
                  : null}
              </span>
            </p>
            <MarkPublishedForm
              action={markPublished}
              defaultMlsNumber={prop.mls_number}
              active={!publishBlockers.includes("listing_not_active")}
              agreementCompleted={!publishBlockers.includes("agreement_not_completed")}
              planPaid={!publishBlockers.includes("payment_not_succeeded")}
            />
            <p className="text-xs text-ink/55">
              Do it once the listing is live in Matrix. The date is now; it can&apos;t be edited
              afterwards (only an admin can correct it, with a note).
            </p>
          </div>
        )}

        {prop.mls_published_at && isAdminRole === true && (
          <details>
            <summary className="cursor-pointer text-[10px] uppercase tracking-[0.22em] text-ink/60 hover:text-gold">
              Correct the date (admin) →
            </summary>
            <form action={correctPublished} className="flex flex-col gap-3 mt-3 max-w-xl">
              <label className="flex flex-col gap-1">
                <span className="text-[10px] uppercase tracking-[0.18em] text-ink/55">
                  Published on (Miami time)
                </span>
                <input
                  name="published_at"
                  type="datetime-local"
                  defaultValue={toMiamiDateTimeInput(prop.mls_published_at)}
                  className="w-60 border border-gold-soft bg-ivory px-3 py-2 text-sm text-ink focus:outline-none focus:border-gold"
                />
              </label>
              <label className="flex items-center gap-2 text-sm text-ink">
                <input type="checkbox" name="clear" value="1" />
                Clear the date (the listing was never published)
              </label>
              <textarea
                name="note"
                rows={2}
                required
                minLength={MIN_CORRECTION_NOTE}
                maxLength={2000}
                placeholder="Why is the date being corrected? (required)"
                className="border border-gold-soft bg-ivory px-3 py-2 text-sm text-ink focus:outline-none focus:border-gold"
              />
              <button
                type="submit"
                className="self-start inline-flex items-center px-6 py-3 border border-gold-soft text-ink text-[10px] font-medium tracking-[0.22em] uppercase hover:border-gold transition-colors"
              >
                Save correction
              </button>
            </form>
          </details>
        )}

        {publishedHistory.length > 0 && (
          <div className="flex flex-col gap-1 border-t border-gold-soft pt-3">
            <span className="text-[10px] uppercase tracking-[0.18em] text-ink/55">History</span>
            <ul className="text-xs text-ink/70 flex flex-col gap-1">
              {publishedHistory.map((h) => (
                <li key={`${h.changed_at}-${h.changed_by}`}>
                  {formatMiamiDateTime(h.changed_at)} · {actorName.get(h.changed_by) ?? h.changed_by}:{" "}
                  {h.old_published_at ? formatMiamiDateTime(h.old_published_at) : "—"} →{" "}
                  {h.new_published_at ? formatMiamiDateTime(h.new_published_at) : "cleared"}
                  {h.note ? <span className="italic"> · “{h.note}”</span> : null}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

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
        <Link
          href={`/${lang}/admin/listings/${id}/matrix`}
          className="self-start inline-flex items-center px-6 py-3 bg-ink text-ivory text-[10px] font-medium tracking-[0.22em] uppercase hover:bg-ink/85 transition-colors"
        >
          Matrix input sheet →
        </Link>
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
        {(() => {
          const offer = offerFromRow(prop);
          return (
            <>
              {field("Buyer's agent compensation", offer ? formatOffer(offer) : null)}
              {/* Apagado mientras se confirma qué acuerdo corresponde (CASSB1_ENABLED). */}
              {CASSB1_ENABLED &&
                field(
                  "CASSB-1",
                  offer
                    ? compensationAgreementsFor(offer) === 1
                      ? "Needed when a buyer's agent asks for it"
                      : "Not needed (0%)"
                    : null,
                )}
            </>
          );
        })()}
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
            ⚠️ Seller hasn&apos;t signed the listing agreement. Approval stays
            blocked until the seller signs and the broker countersigns.
          </p>
        )}
        {legalPending && (
          <p data-legal-pending className="text-xs text-red-700">
            ⚠️ {legalPendingMessage(lang)}. {legalPendingHint(lang)}
          </p>
        )}
        {awaitingCountersign && (
          <p className="text-xs text-amber-700">
            ⚠️ Seller signed; waiting for the broker&apos;s countersignature in
            DocuSign. Approval stays blocked until then.
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
            disabled={legalPending || prop.is_test}
            title={prop.is_test ? testListingMessage(lang) : legalPending ? legalPendingMessage(lang) : undefined}
            className="inline-flex items-center px-6 py-3 bg-ink text-ivory text-[10px] font-medium tracking-[0.22em] uppercase hover:bg-ink/85 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Approve → Active
          </button>
          {prop.is_test && (
            <span data-test-listing className="text-[11px] text-red-700">
              {testListingMessage(lang)}
            </span>
          )}
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
