"use client";

// Step 3: financing the seller accepts (Cash, Conventional, VA, FHA, Other). Goes to line 23 of
// the listing agreement, read-only there. The "Other" text appears, and is required, only with
// Other checked (src/lib/financing-terms.ts; the server validates it again).

import { useState } from "react";
import { FINANCING_OTHER_MAX, FINANCING_TERMS, type FinancingTerm } from "@/lib/financing-terms";

export interface FinancingLabels {
  title: string;
  help: string;
  options: Record<FinancingTerm, string>;
  otherLabel: string;
  otherPlaceholder: string;
}

const labelClass = "text-[10px] font-semibold uppercase tracking-[0.22em] text-ink/55";

export function FinancingSection({
  initialTerms,
  initialOther,
  labels: L,
}: {
  initialTerms: FinancingTerm[];
  initialOther: string;
  labels: FinancingLabels;
}) {
  const [other, setOther] = useState(initialTerms.includes("other"));
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className={labelClass}>{L.title}</legend>
      <span className="text-xs text-ink/50">{L.help}</span>
      <div className="flex flex-wrap gap-x-6 gap-y-3">
        {FINANCING_TERMS.map((t) => (
          <label key={t} className="flex items-center gap-3 text-sm text-ink/80 cursor-pointer">
            <input
              type="checkbox"
              name="financing_terms"
              value={t}
              defaultChecked={initialTerms.includes(t)}
              onChange={t === "other" ? (e) => setOther(e.target.checked) : undefined}
              className="accent-gold w-4 h-4"
            />
            <span>{L.options[t]}</span>
          </label>
        ))}
      </div>
      {other && (
        <label className="flex flex-col gap-2">
          <span className={labelClass}>{L.otherLabel}</span>
          <input
            type="text"
            name="financing_other"
            required
            maxLength={FINANCING_OTHER_MAX}
            defaultValue={initialOther}
            placeholder={L.otherPlaceholder}
            className="bg-ivory border-2 border-gold-soft px-4 py-3 text-base text-ink focus:outline-none focus:border-gold"
          />
        </label>
      )}
    </fieldset>
  );
}
