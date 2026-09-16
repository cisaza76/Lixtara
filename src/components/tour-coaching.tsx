// Seller-side recording guide for the property video. INFORMATIONAL ONLY:
// no upload, no storage, no backend — the real uploader is SourceVideoSection
// in the dashboard, gated by the Creative Studio allowlist.
//
// 2026-08-10 — reemplazo del bloque "3D / Premium video tour · In preparation"
// (auditoría de producción, hallazgos B-5 y B-6). Se retiraron: toda mención a
// tours 3D (capacidad inexistente), la píldora de estado "In preparation", el
// CTA "Request early activation" (botón deshabilitado sin endpoint detrás) y el
// motivo decorativo de cubo 3D. Se añadieron los límites REALES de ingesta
// (MP4/MOV · 60 s · 300 MB), que hasta ahora no se comunicaban en ninguna
// superficie del producto. Este panel NO promete disponibilidad ni fechas.

export interface TourCoachingCopy {
  eyebrow: string;
  title: string;
  body: string;
  guideTitle: string;
  tips: readonly string[];
}

export function TourCoaching({ copy }: { copy: TourCoachingCopy }) {
  return (
    <div className="relative overflow-hidden border border-gold-soft bg-ivory-strong/30 p-6 lg:p-8">
      {/* faint camera motif, decorative */}
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="pointer-events-none absolute -right-8 -bottom-10 h-48 w-48 text-gold/10"
      >
        <path d="m22 8-6 4 6 4V8z" />
        <rect width="14" height="12" x="2" y="6" rx="2" ry="2" />
      </svg>

      <div className="relative flex flex-col gap-6">
        {/* header: eyebrow */}
        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-gold">
          {copy.eyebrow}
        </p>

        {/* medallion + title + microcopy */}
        <div className="flex items-start gap-5">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-gold-soft bg-ivory text-gold">
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-6 w-6"
            >
              <path d="m22 8-6 4 6 4V8z" />
              <rect width="14" height="12" x="2" y="6" rx="2" ry="2" />
            </svg>
          </div>
          <div className="flex flex-col gap-2">
            <p className="font-display text-lg leading-snug text-ink lg:text-xl">
              {copy.title}
            </p>
            <p className="max-w-prose text-sm leading-relaxed text-ink/70">
              {copy.body}
            </p>
          </div>
        </div>

        {/* recording guide */}
        <div className="border-t border-gold-soft pt-6">
          <p className="mb-4 text-[10px] font-semibold uppercase tracking-[0.22em] text-ink/55">
            {copy.guideTitle}
          </p>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {copy.tips.map((tip) => (
              <li key={tip} className="flex items-start gap-2.5">
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                  className="mt-0.5 shrink-0 text-gold"
                >
                  <path d="M20 6 9 17l-5-5" />
                </svg>
                <span className="text-sm leading-snug text-ink/75">{tip}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
