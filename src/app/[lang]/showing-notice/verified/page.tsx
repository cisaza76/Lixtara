// Después de verificar el correo (aviso NBR aceptado en el formulario).
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isLocale } from "@/lib/i18n";
import { nbrCopy } from "@/lib/nbr-notice";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function BuyerEmailVerifiedPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const c = nbrCopy(lang);
  return (
    <section role="status" className="mx-auto w-full max-w-2xl px-4 sm:px-6 py-12 flex flex-col gap-3">
      <h1 className="font-display text-3xl text-ink font-normal">{c.verifiedTitle}</h1>
      <p className="text-sm text-ink/75">{c.verifiedBody}</p>
      <p className="text-sm text-ink/75">{c.haveAgentLine}</p>
    </section>
  );
}
