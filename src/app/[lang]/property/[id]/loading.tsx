// Skeleton shown while a property detail streams. Pulse respects
// prefers-reduced-motion.

function Box({ className }: { className: string }) {
  return (
    <div
      className={`bg-ivory-strong animate-pulse motion-reduce:animate-none ${className}`}
    />
  );
}

export default function Loading() {
  return (
    <main className="bg-background flex-1">
      <div className="mx-auto w-full max-w-7xl px-6 lg:px-12 pt-8 lg:pt-10">
        <Box className="h-3 w-32" />
      </div>
      <section className="mx-auto w-full max-w-7xl px-6 lg:px-12 pt-8 pb-16 lg:pb-24">
        <Box className="mb-12 aspect-[16/10] w-full lg:mb-16 lg:aspect-[2/1]" />
        <div className="grid grid-cols-1 gap-12 lg:grid-cols-12 lg:gap-16">
          <div className="flex flex-col gap-8 lg:col-span-7">
            <Box className="h-3 w-40" />
            <Box className="h-12 w-3/4" />
            <Box className="h-10 w-48" />
            <div className="grid grid-cols-2 gap-6 border-t border-gold-soft pt-10 md:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex flex-col gap-2.5">
                  <Box className="h-5 w-5" />
                  <Box className="h-7 w-12" />
                  <Box className="h-3 w-16" />
                </div>
              ))}
            </div>
            <div className="flex flex-col gap-3 border-t border-gold-soft pt-10">
              <Box className="h-4 w-full" />
              <Box className="h-4 w-5/6" />
              <Box className="h-4 w-2/3" />
            </div>
          </div>
          <div className="flex flex-col gap-8 lg:col-span-5">
            <Box className="aspect-[3/2] w-full border border-gold-soft" />
            <Box className="h-40 w-full border border-gold-soft" />
          </div>
        </div>
      </section>
    </main>
  );
}
