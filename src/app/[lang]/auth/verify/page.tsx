import Link from "next/link";
import { notFound } from "next/navigation";
import { isLocale, t } from "@/lib/i18n";
import { AuthShell } from "@/components/auth-shell";

export default async function VerifyPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const copy = t(lang).auth.verify;

  return (
    <AuthShell
      eyebrow={copy.eyebrow}
      titleBefore={copy.titleBefore}
      titleAccent={copy.titleAccent}
      titleAfter={copy.titleAfter}
    >
      <p className="text-base leading-relaxed text-ink/70">{copy.body}</p>
      <Link
        href={`/${lang}/sign-in`}
        className="text-[10px] uppercase tracking-[0.22em] text-gold hover:text-ink transition-colors"
      >
        ← {copy.backToSignIn}
      </Link>
    </AuthShell>
  );
}
