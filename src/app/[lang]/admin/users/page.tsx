import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { isLocale } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";

interface UserRow {
  id: string;
  email: string;
  phone: string | null;
  first_name: string | null;
  last_name: string | null;
  role: string | null;
  created_at: string;
}

const ROLES = ["all", "seller", "buyer", "broker", "admin"] as const;
const ASSIGNABLE = ["seller", "buyer", "broker", "admin"] as const;

const ROLE_BADGE: Record<string, string> = {
  admin: "border-gold bg-gold/10 text-ink",
  broker: "border-blue-300 bg-blue-50 text-blue-800",
  buyer: "border-green-300 bg-green-50 text-green-800",
  seller: "border-gold-soft bg-ivory-strong/40 text-ink/70",
};

// Service client — the `users` table only allows own-record reads under RLS,
// so listing/managing all users needs the service role. The page is already
// gated to admin/broker by the admin layout.
function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) return null;
  return createServiceClient(url, key, { auth: { persistSession: false } });
}

export default async function AdminUsersPage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{ role?: string; q?: string; error?: string }>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const sp = await searchParams;
  const role = ROLES.includes(sp.role as (typeof ROLES)[number])
    ? (sp.role as string)
    : "all";
  const q = (sp.q ?? "").trim();

  const svc = serviceClient();
  let users: UserRow[] = [];
  if (svc) {
    let query = svc
      .from("users")
      .select("id,email,phone,first_name,last_name,role,created_at")
      .order("created_at", { ascending: false })
      .limit(500);
    if (role !== "all") query = query.eq("role", role);
    if (q)
      query = query.or(
        `email.ilike.%${q}%,first_name.ilike.%${q}%,last_name.ilike.%${q}%`,
      );
    const { data } = await query;
    users = (data ?? []) as UserRow[];
  }

  async function changeRole(formData: FormData) {
    "use server";
    const targetId = String(formData.get("user_id") ?? "");
    const newRole = String(formData.get("role") ?? "");
    if (
      !targetId ||
      !(ASSIGNABLE as readonly string[]).includes(newRole)
    )
      return;

    // Role assignment is ADMIN-ONLY (stricter than the page's admin|broker gate).
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) redirect(`/${lang}/sign-in?next=/admin`);
    const { data: isAdmin } = await supabase.rpc("has_role", { _role: "admin" });
    if (isAdmin !== true) redirect(`/${lang}/dashboard`);

    // Don't let an admin demote themselves (lockout guard).
    if (targetId === user.id && newRole !== "admin") {
      redirect(`/${lang}/admin/users?error=self_lockout`);
    }

    const svc = serviceClient();
    if (!svc) redirect(`/${lang}/admin/users?error=no_service`);

    await svc
      .from("users")
      .update({ role: newRole, updated_at: new Date().toISOString() })
      .eq("id", targetId);

    // Sync user_roles (what has_role() reads). app_role only has the privileged
    // roles; seller/buyer carry no row.
    await svc.from("user_roles").delete().eq("user_id", targetId);
    if (newRole === "admin" || newRole === "broker") {
      await svc.from("user_roles").insert({ user_id: targetId, role: newRole });
    }

    revalidatePath(`/${lang}/admin/users`);
  }

  return (
    <div className="flex flex-col gap-8">
      <h1 className="font-display text-3xl text-ink font-normal">Users</h1>

      {sp.error === "self_lockout" && (
        <div className="border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          You can&apos;t remove your own admin role.
        </div>
      )}
      {sp.error === "no_service" && (
        <div className="border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          Service key not configured — role changes are unavailable.
        </div>
      )}
      {!svc && (
        <div className="border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Service key not configured — the user directory can&apos;t be loaded.
        </div>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex flex-wrap gap-2">
          {ROLES.map((r) => {
            const href = `/${lang}/admin/users?role=${r}${q ? `&q=${encodeURIComponent(q)}` : ""}`;
            return (
              <a
                key={r}
                href={href}
                className={`px-3 py-2 text-[10px] uppercase tracking-[0.18em] border transition-colors ${
                  role === r
                    ? "border-gold bg-gold/10 text-ink"
                    : "border-gold-soft text-ink/60 hover:border-gold/60"
                }`}
              >
                {r}
              </a>
            );
          })}
        </div>
        <form action={`/${lang}/admin/users`} className="flex gap-2 ml-auto">
          <input type="hidden" name="role" value={role} />
          <input
            type="text"
            name="q"
            defaultValue={q}
            placeholder="Name or email…"
            className="border border-gold-soft bg-ivory px-3 py-1.5 text-sm text-ink focus:outline-none focus:border-gold"
          />
          <button
            type="submit"
            className="px-4 py-1.5 bg-ink text-ivory text-[10px] uppercase tracking-[0.22em]"
          >
            Search
          </button>
        </form>
      </div>

      {users.length === 0 ? (
        <p className="text-sm text-ink/55 italic">No users match.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-[0.18em] text-ink/55 border-b border-gold-soft">
                <th className="py-3 pr-4">Name</th>
                <th className="py-3 pr-4">Email</th>
                <th className="py-3 pr-4">Phone</th>
                <th className="py-3 pr-4">Role</th>
                <th className="py-3 pr-4">Joined</th>
                <th className="py-3">Change role</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const name =
                  [u.first_name, u.last_name].filter(Boolean).join(" ").trim() ||
                  "—";
                const r = u.role ?? "seller";
                return (
                  <tr key={u.id} className="border-b border-gold-soft/50">
                    <td className="py-3 pr-4 text-ink">{name}</td>
                    <td className="py-3 pr-4 text-ink/70 text-xs">{u.email}</td>
                    <td className="py-3 pr-4 text-ink/70 text-xs">
                      {u.phone ?? "—"}
                    </td>
                    <td className="py-3 pr-4">
                      <span
                        className={`inline-block text-[9px] uppercase tracking-[0.18em] px-2.5 py-1 border ${ROLE_BADGE[r] ?? ROLE_BADGE.seller}`}
                      >
                        {r}
                      </span>
                    </td>
                    <td className="py-3 pr-4 text-xs text-ink/60 whitespace-nowrap">
                      {new Date(u.created_at).toLocaleDateString(lang)}
                    </td>
                    <td className="py-3">
                      <form action={changeRole} className="flex items-center gap-2">
                        <input type="hidden" name="user_id" value={u.id} />
                        <select
                          name="role"
                          defaultValue={r}
                          className="border border-gold-soft bg-ivory px-2 py-1 text-xs text-ink focus:outline-none focus:border-gold"
                        >
                          {ASSIGNABLE.map((opt) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                        <button
                          type="submit"
                          className="px-3 py-1 border border-gold-soft text-[10px] uppercase tracking-[0.18em] text-ink/70 hover:border-gold hover:text-ink transition-colors"
                        >
                          Save
                        </button>
                      </form>
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
