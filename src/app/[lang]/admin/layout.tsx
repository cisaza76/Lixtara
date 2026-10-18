import { notFound } from "next/navigation";
import { isLocale, t, type Locale } from "@/lib/i18n";
import { requireAdminOrBroker } from "@/lib/admin-auth";
import { AdminNav } from "@/components/admin/admin-nav";

export default async function AdminLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const { pendingTasks } = await requireAdminOrBroker(lang as Locale);
  const copy = t(lang).admin;

  return (
    <div className="flex-1 flex min-h-0">
      <AdminNav lang={lang} pendingTasks={pendingTasks} labels={copy.nav} />
      <div className="flex-1 flex flex-col min-w-0">
        {/* Permanent legal reminder — admin staff must never give legal advice. */}
        <div className="bg-amber-50 border-b border-amber-200 px-6 py-2.5 text-xs text-amber-900 leading-snug">
          ⚖️ <strong>{copy.legalReminderTitle}</strong> {copy.legalReminderBody}
        </div>
        <main className="flex-1 overflow-y-auto p-6 sm:p-8">
          <div className="mx-auto w-full max-w-7xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
