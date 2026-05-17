import { type ReactNode } from "react";

interface Props {
  stepNumber: number;
  totalSteps: number;
  stepNames: readonly string[];
  eyebrow: string;
  titleBefore: string;
  titleAccent: string;
  titleAfter: string;
  stepLabel: string;
  ofLabel: string;
  children: ReactNode;
}

export function StepShell({
  stepNumber,
  totalSteps,
  stepNames,
  eyebrow,
  titleBefore,
  titleAccent,
  titleAfter,
  stepLabel,
  ofLabel,
  children,
}: Props) {
  return (
    <main className="bg-background text-foreground flex-1 flex flex-col">
      <section className="mx-auto w-full max-w-3xl px-6 lg:px-12 py-16 lg:py-24">
        <div className="flex flex-col gap-4 mb-12">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-gold">
              {eyebrow}
            </p>
            <p className="text-[10px] uppercase tracking-[0.18em] text-ink/55">
              {stepLabel} {stepNumber} {ofLabel} {totalSteps}
            </p>
          </div>
          <h1 className="font-display text-3xl md:text-4xl lg:text-5xl leading-[1.1] tracking-tight text-ink font-normal">
            {titleBefore}
            <em className="italic text-gold">{titleAccent}</em>
            {titleAfter}
          </h1>

          {/* Progress strip */}
          <ol className="mt-6 grid grid-cols-4 md:grid-cols-8 gap-2">
            {stepNames.map((name, i) => {
              const num = i + 1;
              const done = num < stepNumber;
              const active = num === stepNumber;
              return (
                <li key={name} className="flex flex-col gap-1.5">
                  <div
                    className={`h-px ${
                      done || active ? "bg-gold" : "bg-gold-soft"
                    }`}
                  />
                  <span
                    className={`text-[9px] uppercase tracking-[0.15em] ${
                      active
                        ? "text-gold font-semibold"
                        : done
                          ? "text-ink/70"
                          : "text-ink/35"
                    }`}
                  >
                    {String(num).padStart(2, "0")} · {name}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>

        <div className="border-t border-gold-soft pt-12">{children}</div>
      </section>
    </main>
  );
}
