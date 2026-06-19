import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isLocale, type Locale } from "@/lib/i18n";
import { LegalDocument } from "@/components/legal-document";
import { disclaimersDoc } from "@/lib/legal/disclaimers";

export const metadata: Metadata = {
  title: "Disclaimers — Lixtara",
};

export default async function DisclaimersPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  return (
    <LegalDocument lang={lang as Locale} doc={disclaimersDoc[lang as Locale]} />
  );
}
