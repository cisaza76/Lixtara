import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isLocale, type Locale } from "@/lib/i18n";
import { LegalDocument } from "@/components/legal-document";
import { privacyDoc } from "@/lib/legal/privacy";

export const metadata: Metadata = {
  title: "Privacy Policy | Lixtara",
};

export default async function PrivacyPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  return (
    <LegalDocument lang={lang as Locale} doc={privacyDoc[lang as Locale]} />
  );
}
