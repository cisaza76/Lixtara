// Verificación del correo del comprador (aviso NBR aceptado en el formulario). Hasta que pulsa
// el botón, la visita queda "pendiente de verificación" y no se puede confirmar.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isLocale } from "@/lib/i18n";
import { createService } from "@/lib/supabase/service";
import { nbrCopy } from "@/lib/nbr-notice";
import { findUnverified } from "@/lib/nbr-notice.server";
import { verifyBuyerEmail } from "./actions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function VerifyBuyerEmailPage({ params }: { params: Promise<{ lang: string; token: string }> }) {
  const { lang, token } = await params;
  if (!isLocale(lang)) notFound();
  const c = nbrCopy(lang);
  const notice = await findUnverified(createService(), token);
  return (
    <section className="mx-auto w-full max-w-2xl px-4 sm:px-6 py-12 flex flex-col gap-4">
      <h1 className="font-display text-3xl text-ink font-normal">{c.verifyTitle}</h1>
      {!notice ? (
        <p role="alert" className="text-sm text-ink/75">{c.verifyExpired}</p>
      ) : (
        <form action={verifyBuyerEmail} className="flex flex-col gap-4">
          <input type="hidden" name="token" value={token} />
          <input type="hidden" name="lang" value={lang} />
          <p className="text-sm text-ink/75">{c.verifyBody}</p>
          <button
            type="submit"
            className="self-start px-6 py-3.5 bg-ink text-ivory text-[10px] font-medium tracking-[0.22em] uppercase hover:bg-ink/85 transition-colors"
          >
            {c.verifyButton}
          </button>
        </form>
      )}
    </section>
  );
}
