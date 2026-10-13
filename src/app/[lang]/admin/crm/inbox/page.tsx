import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { isLocale, t } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { assertStaff } from "@/lib/admin-auth";
import { dateTime, label, UUID_RE } from "@/lib/crm/format";

// Replies and interested leads not yet handled. Marking goes through
// crm_set_outreach_handled() — staff has no UPDATE grant on crm_outreach.
// Creating the consultation / $495 listing deal from here is a separate PR:
// for now each row links to the owner.
const INBOX_EVENTS = ["reply_received", "lead_interested"];

interface InboxRow {
  id: string;
  event_type: string;
  occurred_at: string;
  email: string | null;
  reply_subject: string | null;
  reply_text: string | null;
  handled_at: string | null;
  owner_id: string | null;
  crm_owners: { registered_name: string } | null;
}

export default async function CrmInboxPage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{ view?: string; error?: string }>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const c = t(lang).crm;
  const sp = await searchParams;
  const handledView = sp.view === "handled";

  const supabase = await createClient();
  let query = supabase
    .from("crm_outreach")
    .select("id,event_type,occurred_at,email,reply_subject,reply_text,handled_at,owner_id,crm_owners(registered_name)")
    .in("event_type", INBOX_EVENTS)
    .order("occurred_at", { ascending: false })
    .limit(200);
  query = handledView ? query.not("handled_at", "is", null) : query.is("handled_at", null);
  const { data, error } = await query;
  const rows = (data ?? []) as unknown as InboxRow[];

  async function setHandled(formData: FormData) {
    "use server";
    // Server actions are callable on their own: re-check the role here.
    const sb = await assertStaff(lang);
    const id = String(formData.get("id") ?? "");
    const handled = formData.get("handled") === "true";
    const back = String(formData.get("back") ?? "") === "handled" ? "?view=handled" : "";
    if (!UUID_RE.test(id)) redirect(`/${lang}/admin/crm/inbox${back}`);
    const { error: rpcErr } = await sb.rpc("crm_set_outreach_handled", { p_outreach_id: id, p_handled: handled });
    if (rpcErr) {
      console.error(JSON.stringify({ event: "crm_set_outreach_handled_failed", code: rpcErr.code }));
      redirect(`/${lang}/admin/crm/inbox${back}${back ? "&" : "?"}error=1`);
    }
    redirect(`/${lang}/admin/crm/inbox${back}`);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <p className="text-sm text-ink/60 max-w-3xl">{c.inbox.intro}</p>
        <Link
          href={handledView ? `/${lang}/admin/crm/inbox` : `/${lang}/admin/crm/inbox?view=handled`}
          className="text-[10px] uppercase tracking-[0.22em] text-ink/55 hover:text-ink"
        >
          {handledView ? c.inbox.showOpen : c.inbox.showHandled}
        </Link>
      </div>

      {sp.error && <p className="border border-red-300 bg-red-50 px-4 py-2.5 text-sm text-red-800">{c.inbox.error}</p>}
      {error && <p className="border border-red-300 bg-red-50 px-4 py-2.5 text-sm text-red-800">{c.loadError}</p>}

      {!error && rows.length === 0 ? (
        <p className="text-sm text-ink/55 italic">{c.inbox.empty}</p>
      ) : (
        <ol className="flex flex-col divide-y divide-gold-soft/50 border-y border-gold-soft/50">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-col gap-2 py-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex flex-col gap-1 text-sm min-w-0">
                <div className="flex flex-wrap items-baseline gap-x-3 text-xs text-ink/60">
                  <strong className="text-ink text-sm">
                    {r.crm_owners?.registered_name ?? c.inbox.unknownOwner}
                  </strong>
                  <span>{label(c.events, r.event_type)}</span>
                  <span>{dateTime(lang, r.occurred_at)}</span>
                  {r.email && <span>{r.email}</span>}
                </div>
                {r.reply_subject && <p className="text-ink/80">{r.reply_subject}</p>}
                {r.reply_text && <p className="whitespace-pre-wrap text-ink/80 leading-snug line-clamp-6">{r.reply_text}</p>}
              </div>
              <div className="flex shrink-0 items-center gap-4">
                {r.owner_id && (
                  <Link
                    href={`/${lang}/admin/crm/owners/${r.owner_id}`}
                    className="text-[10px] uppercase tracking-[0.22em] text-gold hover:text-ink whitespace-nowrap"
                  >
                    {c.inbox.openOwner}
                  </Link>
                )}
                <form action={setHandled}>
                  <input type="hidden" name="id" value={r.id} />
                  <input type="hidden" name="handled" value={handledView ? "false" : "true"} />
                  <input type="hidden" name="back" value={handledView ? "handled" : ""} />
                  <button
                    type="submit"
                    className="text-[10px] uppercase tracking-[0.22em] text-ink/70 hover:text-ink whitespace-nowrap"
                  >
                    {handledView ? c.inbox.unmark : c.inbox.markHandled}
                  </button>
                </form>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
