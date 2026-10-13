import { notFound, redirect } from "next/navigation";
import { isLocale } from "@/lib/i18n";

export default async function CrmIndex({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  redirect(`/${lang}/admin/crm/owners`);
}
