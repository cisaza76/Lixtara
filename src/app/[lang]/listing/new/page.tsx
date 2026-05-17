import { notFound } from "next/navigation";
import { isLocale } from "@/lib/i18n";
import { ComingSoon } from "@/components/coming-soon";

export default async function ListingNewPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  return <ComingSoon lang={lang} pageKey="listingNew" />;
}
