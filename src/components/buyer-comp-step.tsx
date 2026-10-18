"use client";

// Paso 6: oferta de compensación al agente del comprador + desglose de costos.
// Va dentro del formulario de "Continuar" (nextFromStep6): los campos se guardan al avanzar.
// Los avisos cambian con la elección y nunca bloquean el avance. Textos legales desde
// src/config/legal-terms.ts; reglas en src/lib/buyer-comp.ts.

import { useId, useState } from "react";
import {
  BUYER_COMP_MAX_PCT,
  buyerCompMaxAmount,
  BUYER_COMP_PRESET_PCTS,
  compareWithOffer,
  formatOffer,
  parseOfferInput,
  type BuyerCompOffer,
} from "@/lib/buyer-comp";
import type { PricingTierId } from "@/lib/pricing-tiers";

export interface BuyerCompStepCopy {
  eyebrow: string;
  title: string;
  body: string;
  noticeOffer: string;
  noticeNoOffer: string;
  conciergeSuggested: string;
  noneLabel: string;
  noneHint: string;
  customLabel: string;
  customHint: string;
  customKindPercent: string;
  customKindAmount: string;
  customPercentLabel: string;
  customAmountLabel: string;
  customPercentHelp: string;
  customAmountHelp: string;
  pctRange: string;
  pctMax: string;
  amountRange: string;
  amountMax: string;
  selected: string;
  fixedTag: string;
  costEyebrow: string;
  costToday: string;
  costAtClosing: string;
  costBuyerAgent: string;
  costTotal: string;
  costTraditional: string;
  costSavings: string;
  costNote: string;
}

interface Props {
  copy: BuyerCompStepCopy;
  tierId: PricingTierId | null;
  commissionPct: number | null;
  traditionalListingPct: number;
  listPrice: number;
  /** "0" | "2" | "2.5" | "3" | "custom" | "" (sin elección) */
  initialChoice: string;
  initialCustomKind: "percent" | "amount";
  initialCustomValue: string;
  /** Concierge: 3% preseleccionado con la etiqueta de la broker. */
  conciergeSuggested: boolean;
  /** Mensaje del servidor (elección o rango inválido). */
  error: string | null;
}

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

export function BuyerCompStep({
  copy,
  tierId,
  commissionPct,
  traditionalListingPct,
  listPrice,
  initialChoice,
  initialCustomKind,
  initialCustomValue,
  conciergeSuggested,
  error,
}: Props) {
  const [choice, setChoice] = useState(initialChoice);
  const [customKind, setCustomKind] = useState<"percent" | "amount">(initialCustomKind);
  const [customValue, setCustomValue] = useState(initialCustomValue);
  const id = useId();
  const errorId = `${id}-error`;
  const noticeId = `${id}-notice`;
  const titleId = `${id}-title`;

  const parsed = choice ? parseOfferInput({ choice, customKind, customValue }, listPrice) : null;
  const offer: BuyerCompOffer | null = parsed?.ok ? parsed.offer : null;
  const notice = offer ? (offer.type === "none" ? copy.noticeNoOffer : copy.noticeOffer) : null;
  const fill = (s: string) =>
    s.replace("{max}", String(BUYER_COMP_MAX_PCT)).replace("{maxAmount}", formatOffer({ type: "amount", amount: buyerCompMaxAmount(listPrice) }));
  // Mismo tope que el servidor (parseOfferInput), dicho mientras escribe.
  const rangeError =
    choice === "custom" && customValue.trim() !== "" && parsed && !parsed.ok
      ? fill(
          { pct_range: copy.pctRange, pct_max: copy.pctMax, amount_range: copy.amountRange, amount_max: copy.amountMax, choice_required: copy.pctRange }[parsed.error],
        )
      : null;
  const rangeErrorId = `${id}-range`;

  const options: { value: string; label: string; hint?: string }[] = [
    { value: "0", label: copy.noneLabel, hint: copy.noneHint },
    ...BUYER_COMP_PRESET_PCTS.map((p) => ({ value: String(p), label: `${p}%` })),
    { value: "custom", label: copy.customLabel, hint: copy.customHint },
  ];

  const cmp = offer && tierId && listPrice > 0 ? compareWithOffer(tierId, listPrice, offer) : null;

  return (
    <>
      <div className="border-t border-gold-soft pt-8 flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-gold">{copy.eyebrow}</p>
          <h3 id={titleId} className="font-display text-2xl text-ink leading-tight">
            {copy.title}
          </h3>
          <p className="text-sm text-ink/70 leading-relaxed">{copy.body}</p>
        </div>

        {error && (
          <p id={errorId} role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}

        <div
          role="radiogroup"
          aria-labelledby={titleId}
          aria-describedby={[error ? errorId : null, notice ? noticeId : null].filter(Boolean).join(" ") || undefined}
          className="grid grid-cols-2 sm:grid-cols-5 gap-3"
        >
          {options.map((o) => {
            const active = choice === o.value;
            const suggested = conciergeSuggested && o.value === "3";
            return (
              <label
                key={o.value}
                className={`relative flex flex-col gap-1 p-4 border-2 cursor-pointer transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-gold ${
                  o.value === "custom" ? "col-span-2 sm:col-span-1" : ""
                } ${active ? "border-gold bg-gold/10" : "border-gold-soft bg-ivory hover:border-gold/60"}`}
              >
                <input
                  type="radio"
                  name="buyer_comp_choice"
                  value={o.value}
                  checked={active}
                  onChange={() => setChoice(o.value)}
                  className="sr-only"
                />
                <span
                  className={`font-display text-ink ${
                    o.value === "custom"
                      ? "text-xl leading-tight break-words hyphens-auto min-w-0"
                      : "text-2xl leading-none"
                  }`}
                >
                  {o.label}
                </span>
                {o.hint && <span className="text-xs text-ink/60">{o.hint}</span>}
                {suggested && <span className="text-[10px] text-gold leading-snug">★ {copy.conciergeSuggested}</span>}
                {active && (
                  <span className="absolute top-2 right-2 text-[9px] uppercase tracking-[0.18em] text-gold font-semibold">
                    ✓ <span className="sr-only">{copy.selected}</span>
                  </span>
                )}
              </label>
            );
          })}
        </div>

        {choice === "custom" && (
          <div className="flex flex-col gap-3 border border-gold-soft p-4">
            <div className="flex flex-wrap gap-4" role="radiogroup" aria-label={copy.customLabel}>
              {(["percent", "amount"] as const).map((k) => (
                <label key={k} className="inline-flex items-center gap-2 text-sm text-ink">
                  <input
                    type="radio"
                    name="buyer_comp_custom_kind"
                    value={k}
                    checked={customKind === k}
                    onChange={() => setCustomKind(k)}
                    className="accent-gold"
                  />
                  {k === "percent" ? copy.customKindPercent : copy.customKindAmount}
                </label>
              ))}
            </div>
            <label className="flex flex-col gap-1 text-sm text-ink" htmlFor={`${id}-value`}>
              {customKind === "percent" ? copy.customPercentLabel : copy.customAmountLabel}
            </label>
            <div className="flex items-center gap-2">
              {customKind === "amount" && <span className="text-ink/60">$</span>}
              <input
                id={`${id}-value`}
                name="buyer_comp_custom_value"
                inputMode="decimal"
                autoComplete="off"
                value={customValue}
                onChange={(e) => setCustomValue(e.target.value)}
                aria-describedby={[`${id}-help`, rangeError ? rangeErrorId : null].filter(Boolean).join(" ")}
                aria-invalid={rangeError ? true : undefined}
                className="w-40 border border-gold-soft bg-ivory px-3 py-2 text-ink focus:border-gold focus:outline-none"
              />
              {customKind === "percent" && <span className="text-ink/60">%</span>}
            </div>
            <p id={`${id}-help`} className="text-xs text-ink/55">
              {fill(customKind === "percent" ? copy.customPercentHelp : copy.customAmountHelp)}
            </p>
            {rangeError && (
              <p id={rangeErrorId} className="text-sm text-red-700">
                {rangeError}
              </p>
            )}
          </div>
        )}

        <p id={noticeId} role="status" aria-live="polite" className={notice ? "text-sm text-ink/80 leading-relaxed bg-gold/5 border-l-2 border-gold pl-4 py-2" : "sr-only"}>
          {notice ?? ""}
        </p>
      </div>

      {cmp && offer && commissionPct !== null && (
        <div className="border border-gold-soft p-6 flex flex-col gap-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-gold">{copy.costEyebrow}</p>
          <dl className="grid grid-cols-2 gap-y-3 gap-x-6 text-sm">
            <dt className="text-ink/70">{copy.costToday}</dt>
            <dd className="text-right text-ink font-display text-lg">{usd(cmp.flatFee)}</dd>
            <dt className="text-ink/70">{copy.costAtClosing}</dt>
            <dd className="text-right text-ink font-display text-lg">
              {usd(cmp.lixtaraCommission)} <span className="text-[10px] text-ink/55 ml-1">({commissionPct}%)</span>
            </dd>
            <dt className="text-ink/70">{copy.costBuyerAgent}</dt>
            <dd className="text-right text-ink font-display text-lg">
              {usd(cmp.buyerCompensation)}{" "}
              <span className="text-[10px] text-ink/55 ml-1">
                ({offer.type === "amount" ? copy.fixedTag : formatOffer(offer)})
              </span>
            </dd>
            <dt className="text-ink font-semibold border-t border-gold-soft pt-3">{copy.costTotal}</dt>
            <dd className="text-right font-display italic text-2xl text-ink border-t border-gold-soft pt-3">
              {usd(cmp.lixtaraTotal)}
            </dd>
            <dt className="text-ink/55 text-xs">
              {copy.costTraditional.replace("{listingPct}", String(traditionalListingPct))}
            </dt>
            <dd className="text-right text-ink/55 text-sm line-through">{usd(cmp.traditionalTotal)}</dd>
            <dt className="text-gold font-semibold border-t border-gold-soft pt-3">{copy.costSavings}</dt>
            <dd className="text-right font-display italic text-2xl text-gold border-t border-gold-soft pt-3">
              {usd(Math.max(0, cmp.savings))}
            </dd>
          </dl>
          <p className="text-[10px] italic text-ink/55 leading-relaxed">{copy.costNote}</p>
        </div>
      )}
    </>
  );
}
