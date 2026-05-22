import Link from "next/link";
import Image from "next/image";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { isLocale } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";

interface StagedPhoto {
  id: string;
  url: string;
  property_id: string | null;
  original_photo_id: string | null;
  staging_status: string | null;
}

const STATUSES = ["pending", "approved", "rejected"] as const;

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) return null;
  return createServiceClient(url, key, { auth: { persistSession: false } });
}

export default async function AdminVirtualStagingPage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const sp = await searchParams;
  const status = STATUSES.includes(sp.status as (typeof STATUSES)[number])
    ? (sp.status as string)
    : "pending";

  const svc = serviceClient();
  let staged: StagedPhoto[] = [];
  const originalUrl = new Map<string, string>();
  if (svc) {
    const { data } = await svc
      .from("property_photos")
      .select("id,url,property_id,original_photo_id,staging_status")
      .eq("is_staged", true)
      .eq("staging_status", status)
      .order("created_at", { ascending: false });
    staged = (data ?? []) as StagedPhoto[];

    const originalIds = Array.from(
      new Set(staged.map((p) => p.original_photo_id).filter(Boolean) as string[]),
    );
    if (originalIds.length > 0) {
      const { data: originals } = await svc
        .from("property_photos")
        .select("id,url")
        .in("id", originalIds);
      for (const o of (originals ?? []) as Array<{ id: string; url: string }>) {
        originalUrl.set(o.id, o.url);
      }
    }
  }

  async function moderate(formData: FormData) {
    "use server";
    const decision = String(formData.get("decision") ?? "");
    if (!["approved", "rejected"].includes(decision)) return;
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
    const svc = serviceClient();
    if (!svc) return;
    await svc
      .from("property_photos")
      .update({ staging_status: decision })
      .eq("id", String(formData.get("id") ?? ""));
    revalidatePath(`/${lang}/admin/virtual-staging`);
  }

  return (
    <div className="flex flex-col gap-8">
      <h1 className="font-display text-3xl text-ink font-normal">
        Virtual Staging
      </h1>

      <div className="flex flex-wrap gap-2">
        {STATUSES.map((s) => (
          <Link
            key={s}
            href={`/${lang}/admin/virtual-staging?status=${s}`}
            className={`px-3 py-2 text-[10px] uppercase tracking-[0.18em] border transition-colors ${
              status === s
                ? "border-gold bg-gold/10 text-ink"
                : "border-gold-soft text-ink/60 hover:border-gold/60"
            }`}
          >
            {s}
          </Link>
        ))}
      </div>

      {!svc ? (
        <p className="text-sm text-amber-700 italic">
          Service key not configured — staged photos can&apos;t be loaded.
        </p>
      ) : staged.length === 0 ? (
        <p className="text-sm text-ink/55 italic">
          No {status} staged photos.
        </p>
      ) : (
        <ul className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {staged.map((ph) => {
            const orig = ph.original_photo_id
              ? originalUrl.get(ph.original_photo_id)
              : null;
            return (
              <li
                key={ph.id}
                className="border border-gold-soft bg-ivory p-4 flex flex-col gap-3"
              >
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex flex-col gap-1">
                    <span className="text-[9px] uppercase tracking-[0.18em] text-ink/55">
                      Original
                    </span>
                    <div className="relative aspect-[4/3] border border-gold-soft bg-ivory-strong/40 overflow-hidden">
                      {orig ? (
                        <Image
                          src={orig}
                          alt="original"
                          fill
                          sizes="25vw"
                          className="object-cover"
                          unoptimized
                        />
                      ) : (
                        <span className="absolute inset-0 flex items-center justify-center text-[10px] text-ink/40">
                          no original
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-[9px] uppercase tracking-[0.18em] text-gold">
                      Staged
                    </span>
                    <div className="relative aspect-[4/3] border border-gold-soft bg-ivory-strong/40 overflow-hidden">
                      <Image
                        src={ph.url}
                        alt="staged"
                        fill
                        sizes="25vw"
                        className="object-cover"
                        unoptimized
                      />
                    </div>
                  </div>
                </div>
                {status === "pending" && (
                  <div className="flex gap-2">
                    <form action={moderate}>
                      <input type="hidden" name="id" value={ph.id} />
                      <input type="hidden" name="decision" value="approved" />
                      <button
                        type="submit"
                        className="px-4 py-2 bg-ink text-ivory text-[10px] uppercase tracking-[0.22em]"
                      >
                        Approve
                      </button>
                    </form>
                    <form action={moderate}>
                      <input type="hidden" name="id" value={ph.id} />
                      <input type="hidden" name="decision" value="rejected" />
                      <button
                        type="submit"
                        className="px-4 py-2 border border-red-300 text-red-800 text-[10px] uppercase tracking-[0.22em] hover:bg-red-50 transition-colors"
                      >
                        Reject
                      </button>
                    </form>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
