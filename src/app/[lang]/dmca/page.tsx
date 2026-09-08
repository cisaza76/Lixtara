import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isLocale, type Locale } from "@/lib/i18n";
import { LegalDocument } from "@/components/legal-document";
import { dmcaDoc } from "@/lib/legal/dmca";

export const metadata: Metadata = {
  title: "Copyright & DMCA Policy — Lixtara",
};

export default async function DmcaPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  return <LegalDocument lang={lang as Locale} doc={dmcaDoc[lang as Locale]} />;
}
