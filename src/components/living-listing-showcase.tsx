"use client";

// Public "Living Listing" section on the property page. Renders the ready
// AI-motion clips (tour_jobs where tour_kind='video' & status='ready') produced
// from the REAL listing photos. Always labeled as AI-generated motion per the
// MLS-compliance disclaimer — mirrors the virtual-staging labeling pattern.

interface LivingVideo {
  /** signed playback URL */
  url: string;
  /** original photo URL, used as the <video> poster */
  poster: string | null;
}

interface LivingListingShowcaseProps {
  videos: LivingVideo[];
  copy: {
    eyebrow: string;
    title: string;
    body: string;
    badge: string;
    disclaimer: string;
  };
}

export function LivingListingShowcase({
  videos,
  copy,
}: LivingListingShowcaseProps) {
  if (videos.length === 0) return null;

  return (
    <section className="mb-12 lg:mb-16">
      <div className="mb-6 flex flex-col gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-gold">
          {copy.eyebrow}
        </span>
        <h2 className="font-display text-2xl lg:text-3xl text-ink font-normal">
          {copy.title}
        </h2>
        <p className="max-w-2xl text-sm text-ink/70">{copy.body}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {videos.map((v, i) => (
          <div
            key={i}
            className="relative overflow-hidden rounded-xl border border-gold-soft/40 bg-ink/[0.02] aspect-[4/3]"
          >
            <video
              className="h-full w-full object-cover"
              src={v.url}
              poster={v.poster ?? undefined}
              controls
              loop
              muted
              playsInline
              preload="metadata"
            />
            <div className="pointer-events-none absolute left-3 top-3 inline-flex items-center gap-1 rounded-full bg-ink/75 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.18em] text-ivory backdrop-blur-sm">
              <svg
                width="10"
                height="10"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M5 3l14 9-14 9V3z" />
              </svg>
              {copy.badge}
            </div>
          </div>
        ))}
      </div>

      <p className="mt-3 text-[10px] uppercase tracking-[0.18em] text-ink/55 italic">
        {copy.disclaimer}
      </p>
    </section>
  );
}
