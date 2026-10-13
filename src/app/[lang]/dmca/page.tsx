import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isLocale, type Locale } from "@/lib/i18n";
import { LegalDocument } from "@/components/legal-document";
import { dmcaDoc } from "@/lib/legal/dmca";

// El título de la pestaña sale del propio documento, en el idioma de la página.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string }>;
}): Promise<Metadata> {
  const { lang } = await params;
  const doc = dmcaDoc[isLocale(lang) ? lang : "en"];
  return { title: `${doc.title} | Lixtara` };
}

export default async function DmcaPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  return <LegalDocument lang={lang as Locale} doc={dmcaDoc[lang as Locale]} />;
}
