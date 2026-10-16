import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isLocale, type Locale } from "@/lib/i18n";
import { LegalDocument } from "@/components/legal-document";
import { COOKIES_LAST_UPDATED } from "@/lib/legal/types";
import { cookiesDoc, cookiesDocFor } from "@/lib/legal/cookies";
import { analyticsConfig } from "@/lib/analytics-config";

// El título de la pestaña sale del propio documento, en el idioma de la página.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string }>;
}): Promise<Metadata> {
  const { lang } = await params;
  const doc = cookiesDoc[isLocale(lang) ? lang : "en"];
  return { title: `${doc.title} | Lixtara` };
}

export default async function CookiesPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  // La política describe lo que el sitio hace de verdad: con o sin analítica configurada.
  const { gtmId, posthogKey } = analyticsConfig({
    NEXT_PUBLIC_GTM_ID: process.env.NEXT_PUBLIC_GTM_ID,
    NEXT_PUBLIC_POSTHOG_KEY: process.env.NEXT_PUBLIC_POSTHOG_KEY,
  });
  return (
    <LegalDocument
      lang={lang as Locale}
      doc={cookiesDocFor(lang as Locale, { gtm: gtmId !== null, posthog: posthogKey !== null })}
      updatedOn={COOKIES_LAST_UPDATED}
    />
  );
}
