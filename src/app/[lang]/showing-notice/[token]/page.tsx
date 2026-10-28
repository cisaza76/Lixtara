// Aviso NBR por enlace (F.S. 475.278(4)): el comprador sin agente lo lee y lo acepta antes de
// la visita. El enlace lo manda la broker desde la ficha del lead o Loui al pedir la visita.
// Sin datos personales en la URL: solo el token de un solo uso (en la base, su hash).
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isLocale } from "@/lib/i18n";
import { createService } from "@/lib/supabase/service";
import { nbrCopy } from "@/lib/nbr-notice";
import { findOpenNotice } from "@/lib/nbr-notice.server";
import { NbrNoticeText } from "@/components/nbr-notice-text";
import { acceptNbrNotice } from "./actions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { robots: { index: false, follow: false } };

const CONTROL =
  "w-full border border-gold-soft bg-ivory px-3 py-2.5 text-sm text-ink focus:outline-none focus:border-gold";
const LABEL = "text-[10px] font-semibold uppercase tracking-[0.18em] text-ink/60";

export default async function ShowingNoticePage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string; token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { lang, token } = await params;
  if (!isLocale(lang)) notFound();
  const { error } = await searchParams;
  const c = nbrCopy(lang);
  const notice = await findOpenNotice(createService(), token);

  return (
    <section className="mx-auto w-full max-w-2xl px-4 sm:px-6 py-12 flex flex-col gap-6">
      <h1 className="font-display text-3xl text-ink font-normal">{c.heading}</h1>
      {!notice ? (
        <p role="alert" className="text-sm text-ink/75">{c.expired}</p>
      ) : (
        <>
          <p className="text-sm text-ink/75">{c.explain}</p>
          <div className="border border-gold-soft bg-ivory-strong/40 p-5">
            <NbrNoticeText lang={lang} />
          </div>
          <form action={acceptNbrNotice} className="flex flex-col gap-4">
            <input type="hidden" name="token" value={token} />
            <input type="hidden" name="lang" value={lang} />
            <label className="flex flex-col gap-1.5">
              <span className={LABEL}>{c.signatureName}</span>
              <input name="full_name" required maxLength={120} defaultValue={notice.full_name ?? ""} autoComplete="name" className={CONTROL} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={LABEL}>{c.phone}</span>
              <input name="phone" type="tel" maxLength={25} defaultValue={notice.phone ?? ""} autoComplete="tel" className={CONTROL} />
            </label>
            <label className="flex items-start gap-2 text-xs text-ink/80">
              <input type="checkbox" name="nbr_accept" required className="mt-0.5" />
              <span>{c.accept}</span>
            </label>
            {error && (
              <p role="alert" className="text-sm text-red-800">
                {error === "name" ? c.errors.name : error === "expired" ? c.expired : c.errors.nbr}
              </p>
            )}
            <button
              type="submit"
              className="self-start px-6 py-3.5 bg-ink text-ivory text-[10px] font-medium tracking-[0.22em] uppercase hover:bg-ink/85 transition-colors"
            >
              {c.submit}
            </button>
          </form>
        </>
      )}
    </section>
  );
}
