import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isLocale, type Locale } from "@/lib/i18n";
import { LegalDocument } from "@/components/legal-document";
import { termsDoc } from "@/lib/legal/terms";

export const metadata: Metadata = {
  title: "Terms of Service — Lixtara",
};

export default async function TermsPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  return <LegalDocument lang={lang as Locale} doc={termsDoc[lang as Locale]} />;
}
