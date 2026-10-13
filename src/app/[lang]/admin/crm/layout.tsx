import { notFound } from "next/navigation";
import { isLocale, t } from "@/lib/i18n";
import { CrmTabs } from "@/components/admin/crm-tabs";

// The admin layout already gates admin/broker (requireAdminOrBroker); every CRM
// read also goes through RLS (is_crm_admin) with the staff member's session.
export default async function CrmLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const c = t(lang).crm;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-3xl text-ink font-normal">{c.title}</h1>
        <p className="text-sm text-ink/60 max-w-3xl">{c.intro}</p>
      </div>
      <CrmTabs lang={lang} labels={c.tabs} />
      {children}
    </div>
  );
}
