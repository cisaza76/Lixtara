import Link from "next/link";

export interface PaginationLabels {
  label: string;
  previous: string;
  next: string;
  /** Con {page} y {pages}. */
  pageOf: string;
}

const LINK =
  "inline-flex h-11 items-center px-5 border border-gold-soft text-[10px] font-medium tracking-[0.22em] uppercase text-ink hover:border-gold transition-colors";
const DISABLED =
  "inline-flex h-11 items-center px-5 border border-gold-soft/50 text-[10px] font-medium tracking-[0.22em] uppercase text-ink/30";

/** Anterior / Siguiente con "Página X de Y". `hrefFor` arma la URL de cada página. */
export function PaginationNav({
  page,
  pages,
  hrefFor,
  labels,
}: {
  page: number;
  pages: number;
  hrefFor: (page: number) => string;
  labels: PaginationLabels;
}) {
  if (pages <= 1) return null;
  const status = labels.pageOf.replace("{page}", String(page)).replace("{pages}", String(pages));

  return (
    <nav aria-label={labels.label} className="mt-16 flex items-center justify-between gap-4">
      {page > 1 ? (
        <Link href={hrefFor(page - 1)} rel="prev" className={LINK}>← {labels.previous}</Link>
      ) : (
        <span aria-hidden="true" className={DISABLED}>← {labels.previous}</span>
      )}
      <span className="text-[10px] uppercase tracking-[0.22em] text-ink/55 text-center">{status}</span>
      {page < pages ? (
        <Link href={hrefFor(page + 1)} rel="next" className={LINK}>{labels.next} →</Link>
      ) : (
        <span aria-hidden="true" className={DISABLED}>{labels.next} →</span>
      )}
    </nav>
  );
}
