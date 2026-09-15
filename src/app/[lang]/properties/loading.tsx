// Skeleton shown while the listings grid streams. Mirrors the real layout so
// there's no shift. Pulse respects prefers-reduced-motion.

function Box({ className }: { className: string }) {
  return (
    <div
      className={`bg-ivory-strong animate-pulse motion-reduce:animate-none ${className}`}
    />
  );
}

export default function Loading() {
  return (
    // El esqueleto NO es <main>: la página real aporta ese landmark y un
    // documento solo puede tener uno (WCAG 1.3.1 / landmark-unique).
    <div className="bg-background flex-1">
      <section className="mx-auto w-full max-w-7xl px-6 lg:px-12 py-20 lg:py-28">
        <Box className="mb-5 h-3 w-28" />
        <Box className="mb-16 h-12 w-2/3 max-w-xl lg:mb-20" />
        <div className="grid grid-cols-1 gap-x-8 gap-y-12 md:grid-cols-2 lg:grid-cols-3 lg:gap-x-10 lg:gap-y-16">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex flex-col gap-4">
              <div className="aspect-[4/3] animate-pulse border border-gold-soft bg-ivory-strong motion-reduce:animate-none" />
              <Box className="h-7 w-28" />
              <Box className="h-4 w-40" />
              <Box className="h-3 w-32" />
              <div className="mt-3 border-t border-gold-soft pt-3">
                <Box className="h-3 w-44" />
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
