"use client";

// Enlace del selector de idioma: la página actual en el otro idioma (alternateLocaleHref).
// Es de cliente porque el layout no se vuelve a pintar al navegar dentro del sitio: un href
// calculado en el servidor quedaría apuntando a la primera página visitada.
import { Suspense, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { Locale } from "@/lib/i18n";
import { alternateLocaleHref } from "@/lib/routing/alternate-locale";

interface Props {
  altLang: Locale;
  ariaLabel: string;
  className: string;
  children: ReactNode;
}

function WithQuery(props: Props) {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  return <SwitchLink {...props} href={alternateLocaleHref(pathname, search, props.altLang)} />;
}

function WithoutQuery(props: Props) {
  const pathname = usePathname();
  return <SwitchLink {...props} href={alternateLocaleHref(pathname, "", props.altLang)} />;
}

function SwitchLink({ href, ariaLabel, className, children, altLang }: Props & { href: string }) {
  return (
    <Link href={href} hrefLang={altLang} aria-label={ariaLabel} className={className}>
      {children}
    </Link>
  );
}

export function LanguageSwitchLink(props: Props) {
  // useSearchParams pide un límite de Suspense; mientras tanto, la misma página sin la query.
  return (
    <Suspense fallback={<WithoutQuery {...props} />}>
      <WithQuery {...props} />
    </Suspense>
  );
}
