import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isLocale, type Locale } from "@/lib/i18n";
import { LegalDocument } from "@/components/legal-document";
import { cookiesDoc } from "@/lib/legal/cookies";

export const metadata: Metadata = {
  title: "Cookie Policy — Lixtara",
};

export default async function CookiesPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  return (
    <LegalDocument lang={lang as Locale} doc={cookiesDoc[lang as Locale]} />
  );
}
