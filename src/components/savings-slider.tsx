"use client";

// Radical Transparency calculator — full per-tier cost breakdown:
//   - Home value slider + buyer's agent compensation selector (0 / 2 / 2.5 / 3 % or a
//     custom percentage or fixed USD amount)
//   - UPFRONT costs: listing fee, professional photos, DocuSign contracts,
//     subtotal. On Lixtara this is ONLY the flat fee (what Stripe charges).
//   - CLOSING costs: your (listing-side) commission + buyer's agent compensation,
//     subtotal — paid from sale proceeds, so only if the home sells
//   - Total cost + you-save-vs-traditional + a dynamic key-insight callout
//
// The buyer's agent compensation the seller picks applies to BOTH columns (you offer it
// either way), so the savings reflect only what Lixtara replaces on the seller side.
// Every number comes from compareWithOffer (buyer-comp.ts, on top of pricing-tiers.ts),
// the same function step 6 uses. Never hardcode amounts here.

import { useEffect, useRef, useState } from "react";
import { homePriceRange, track } from "@/lib/analytics";
import {
  DEFAULT_BUYER_COMMISSION_PCT,
  PRICING_TIERS,
  TIER_ORDER,
  TRADITIONAL_COSTS,
} from "@/lib/pricing-tiers";
import {
  BUYER_COMP_MAX_PCT,
  buyerCompMaxAmount,
  BUYER_COMP_PRESET_PCTS,
  compareWithOffer,
  formatOffer,
  parseOfferInput,
  type BuyerCompOffer,
} from "@/lib/buyer-comp";
import { InfoTip } from "@/components/info-tip";

interface SavingsCopy {
  priceLabel: string;
  buyerCommissionLabel: string;
  buyerCommissionHint: string;
  buyerCompNone: string;
  buyerCompCustom: string;
  buyerCompCustomPercent: string;
  buyerCompCustomAmount: string;
  buyerCompCustomLabel: string;
  buyerCompPctMax: string;
  buyerCompAmountMax: string;
  youSelected: string;
  upfrontHeader: string;
  closingHeader: string;
  upfrontLegend: string;
  lineListingFee: string;
  lineSellerCommission: string;
  linePhotos: string;
  lineDocusign: string;
  lineUpfrontSubtotal: string;
  lineBuyerCommission: string;
  lineClosingSubtotal: string;
  lineTotal: string;
  lineSavings: string;
  traditionalLabel: string;
  photoDiy: string;
  included: string;
  keyInsightLabel: string;
  keyInsight: string;
  howToRead: string;
  howToReadBody: string;
  infoAriaLabel: string;
  tipListingFee: string;
  tipSellerCommission: string;
  tipPhotos: string;
  tipDocusign: string;
  tipUpfrontSubtotal: string;
  tipBuyerCommission: string;
  tipClosingSubtotal: string;
  tipTotal: string;
  tipSavings: string;
}

interface SavingsSliderProps {
  lang: string;
  copy: SavingsCopy;
  tierNames: Record<"essentials" | "pro" | "concierge", string>;
}

interface Column {
  key: string;
  label: string;
  isTraditional: boolean;
  listingFee: number;
  sellerComm: number;
  sellerPct: number;
  /** dollar amount for traditional; null for tiers (show text instead) */
  photos: number | null;
  photosText: string;
  docusign: number | null;
  upfront: number;
  buyer: number;
  closing: number;
  /** the buyer's agent compensation shown for this column ("2.5%", "$12,000", "0%") */
  buyerShown: string;
  total: number;
  savings: number;
}

// "Visit" = this browser tab's session: the home page and /owners both show the calculator.
const CALCULATOR_USED_KEY = "lx_calc_used";
function calculatorUsedThisVisit(): boolean {
  try {
    if (window.sessionStorage.getItem(CALCULATOR_USED_KEY) === "1") return true;
    window.sessionStorage.setItem(CALCULATOR_USED_KEY, "1");
  } catch {
    /* storage blocked: the ref still limits it to once per page */
  }
  return false;
}

function usd(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

export function SavingsSlider({ lang, copy, tierNames }: SavingsSliderProps) {
  const [price, setPrice] = useState(500_000);
  const touched = useRef(false);
  const sent = useRef(false);
  const [choice, setChoice] = useState(String(DEFAULT_BUYER_COMMISSION_PCT));
  const [customKind, setCustomKind] = useState<"percent" | "amount">("percent");
  const [customValue, setCustomValue] = useState("");
  // The last valid offer: an invalid custom value (while typing) keeps the previous one.
  const [offer, setOffer] = useState<BuyerCompOffer>({ type: "percent", pct: DEFAULT_BUYER_COMMISSION_PCT });
  const choose = (next: { choice?: string; customKind?: "percent" | "amount"; customValue?: string }, atPrice = price) => {
    touched.current = true;
    const c = next.choice ?? choice;
    const k = next.customKind ?? customKind;
    const v = next.customValue ?? customValue;
    if (next.choice !== undefined) setChoice(c);
    if (next.customKind !== undefined) setCustomKind(k);
    if (next.customValue !== undefined) setCustomValue(v);
    const parsed = parseOfferInput({ choice: c, customKind: k, customValue: v }, atPrice);
    if (parsed.ok) setOffer(parsed.offer);
  };
  const buyerShown = formatOffer(offer);
  // Tope de Lixtara (3%), dicho cuando el valor personalizado se pasa; la cifra mostrada
  // sigue con la última oferta válida.
  const customParsed = choice === "custom" && customValue.trim() !== ""
    ? parseOfferInput({ choice, customKind, customValue }, price)
    : null;
  const customMaxMsg = customParsed && !customParsed.ok && (customParsed.error === "pct_max" || customParsed.error === "amount_max")
    ? (customParsed.error === "amount_max" ? copy.buyerCompAmountMax : copy.buyerCompPctMax)
        .replace("{max}", String(BUYER_COMP_MAX_PCT))
        .replace("{maxAmount}", formatOffer({ type: "amount", amount: buyerCompMaxAmount(price) }))
    : null;

  // calculator_used: ONCE per visit (CMO spec), the first time the person stops moving the
  // controls (1.5 s), with the price RANGE (never the exact value) and the kind of offer.
  useEffect(() => {
    if (!touched.current || sent.current) return;
    const timer = setTimeout(() => {
      if (sent.current || calculatorUsedThisVisit()) return;
      sent.current = true;
      track({
        event: "calculator_used",
        home_price_range: homePriceRange(price),
        commission_mode: offer.type,
        lang,
      });
    }, 1500);
    return () => clearTimeout(timer);
  }, [price, offer, lang]);

  // One comparison per plan (compareWithOffer): the compensation the seller picks goes on
  // BOTH sides, so "You save" is only the listing-side difference. Photos and documents
  // are not charged on the traditional side: a listing agent includes them.
  const comparisons = TIER_ORDER.map((id) => ({ id, cmp: compareWithOffer(id, price, offer) }));
  const first = comparisons[0]!.cmp;

  const columns: Column[] = [
    {
      key: "traditional",
      label: copy.traditionalLabel.replace("{pct}", String(TRADITIONAL_COSTS.listingCommissionPct)),
      isTraditional: true,
      listingFee: 0,
      sellerComm: first.traditionalListingCommission,
      sellerPct: TRADITIONAL_COSTS.listingCommissionPct,
      photos: null,
      photosText: copy.included,
      docusign: null,
      upfront: 0,
      buyer: first.buyerCompensation,
      closing: first.traditionalTotal,
      buyerShown,
      total: first.traditionalTotal,
      savings: 0,
    },
    ...comparisons.map(({ id, cmp }): Column => {
      const tier = PRICING_TIERS[id];
      return {
        key: id,
        label: tierNames[id],
        isTraditional: false,
        listingFee: tier.flatFee,
        sellerComm: cmp.lixtaraCommission,
        sellerPct: tier.commissionPct,
        photos: null,
        photosText: tier.includesPhotography ? copy.included : copy.photoDiy,
        docusign: null,
        upfront: cmp.flatFee,
        buyer: cmp.buyerCompensation,
        closing: cmp.lixtaraCommission + cmp.buyerCompensation,
        buyerShown,
        total: cmp.lixtaraTotal,
        savings: cmp.savings,
      };
    }),
  ];

  const bestTier = columns
    .filter((c) => !c.isTraditional)
    .reduce((best, c) => (c.savings > best.savings ? c : best));
  const keyInsightText = copy.keyInsight
    .replace("{tier}", bestTier.label)
    .replace("{pct}", buyerShown)
    .replace("{amount}", usd(bestTier.savings));

  const headerCell =
    "p-3 text-right text-[10px] uppercase tracking-[0.18em] font-semibold";
  const labelCell = "p-3 text-ink/70 text-xs";
  const moneyCell = "p-3 text-right text-ink text-sm";
  const sectionRow =
    "p-3 text-[10px] uppercase tracking-[0.22em] text-gold font-semibold bg-ivory-strong/50";
  const pctTag = "text-[10px] text-ink/55 ml-1";

  return (
    <div className="flex flex-col gap-10">
      {/* Inputs */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between gap-4">
            <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-ink/55">
              {copy.priceLabel}
            </span>
            <span className="font-display italic text-3xl text-ink leading-none">
              <span className="text-gold text-lg align-top">$</span>
              {(price / 1000).toLocaleString("en-US")}
              <span className="text-[10px] uppercase tracking-[0.18em] text-ink/55 font-sans not-italic ml-1">
                K
              </span>
            </span>
          </div>
          <input
            type="range"
            aria-label={copy.priceLabel}
            aria-valuetext={`$${price.toLocaleString("en-US")}`}
            min={200_000}
            max={2_000_000}
            step={25_000}
            value={price}
            onChange={(e) => {
              touched.current = true;
              setPrice(Number.parseInt(e.target.value, 10));
            }}
            className="w-full accent-gold cursor-pointer"
          />
          <div className="flex justify-between text-[10px] uppercase tracking-[0.18em] text-ink/45">
            <span>$200K</span>
            <span>$2M</span>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-ink/55">
            {copy.buyerCommissionLabel}
          </span>
          {/* En móvil, los 4 porcentajes en una fila y "Personalizado" debajo, a todo el
              ancho: con 5 columnas no cabe a 375 px y desborda la página. */}
          <div className="grid grid-cols-4 sm:grid-cols-5 gap-2">
            {[
              { value: "0", label: copy.buyerCompNone },
              ...BUYER_COMP_PRESET_PCTS.map((p) => ({ value: String(p), label: `${p}%` })),
              { value: "custom", label: copy.buyerCompCustom },
            ].map((o) => (
              <button
                key={o.value}
                type="button"
                aria-pressed={choice === o.value}
                onClick={() => choose({ choice: o.value })}
                className={`px-2 py-3 text-sm font-medium tracking-wide transition-colors border-2 ${
                  o.value === "custom" ? "col-span-4 sm:col-span-1" : ""
                } ${
                  choice === o.value
                    ? "border-gold bg-gold/10 text-ink"
                    : "border-gold-soft bg-ivory text-ink/70 hover:border-gold/60"
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
          {choice === "custom" && (
            <div className="flex items-center gap-2">
              <div className="flex border-2 border-gold-soft" role="group" aria-label={copy.buyerCompCustomLabel}>
                {(["percent", "amount"] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={customKind === k}
                    onClick={() => choose({ customKind: k })}
                    className={`px-3 py-2 text-xs ${customKind === k ? "bg-gold/10 text-ink" : "text-ink/60"}`}
                  >
                    {k === "percent" ? copy.buyerCompCustomPercent : copy.buyerCompCustomAmount}
                  </button>
                ))}
              </div>
              <input
                inputMode="decimal"
                aria-label={copy.buyerCompCustomLabel}
                placeholder={customKind === "percent" ? `0.5 – ${BUYER_COMP_MAX_PCT}` : "10,000"}
                value={customValue}
                onChange={(e) => choose({ customValue: e.target.value })}
                aria-invalid={customMaxMsg ? true : undefined}
                className="w-32 border-2 border-gold-soft bg-ivory px-3 py-2 text-sm text-ink focus:border-gold focus:outline-none"
              />
            </div>
          )}
          {customMaxMsg && (
            <p role="status" className="text-xs text-red-700">
              {customMaxMsg}
            </p>
          )}
          <p className="text-xs text-ink/55 italic leading-relaxed">
            {copy.buyerCommissionHint}
          </p>
        </div>
      </div>

      {/* Comparison table */}
      <div className="flex flex-col gap-3">
      <p className="border-l-2 border-gold pl-3 text-xs text-ink/70 leading-relaxed">
        {copy.upfrontLegend}
      </p>
      {/* Móvil: una tarjeta por columna (tradicional y cada plan), una debajo de otra, con
          las mismas cifras que la tabla. En una tabla de 4 columnas a 375 px, Pro y Concierge
          quedaban fuera de la vista sin aviso. */}
      <ul className="md:hidden flex flex-col gap-4">
        {columns.map((c) => (
          <li
            key={c.key}
            className={`border p-5 flex flex-col gap-4 ${
              c.isTraditional ? "border-gold-soft bg-ivory" : "border-gold bg-ivory"
            }`}
          >
            <h3
              className={`text-[11px] uppercase tracking-[0.18em] font-semibold ${
                c.isTraditional ? "text-ink/55" : "text-gold"
              }`}
            >
              {c.label}
            </h3>
            <dl className="flex flex-col gap-2 text-sm">
              <div className="flex items-baseline justify-between gap-4">
                <dt className="text-ink/70 text-xs">{copy.lineUpfrontSubtotal}</dt>
                <dd className="text-ink text-right">{usd(c.upfront)}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-4">
                <dt className="text-ink/70 text-xs">{copy.linePhotos}</dt>
                <dd className="text-ink/60 italic text-right">{c.photosText}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-4">
                <dt className="text-ink/70 text-xs">{copy.lineSellerCommission}</dt>
                <dd className="text-ink text-right">
                  {usd(c.sellerComm)}
                  <span className={pctTag}>({c.sellerPct}%)</span>
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-4">
                <dt className="text-ink/70 text-xs">{copy.lineBuyerCommission}</dt>
                <dd className="text-ink text-right">
                  {usd(c.buyer)}
                  <span className={pctTag}>({c.buyerShown})</span>
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-4 border-t border-gold-soft pt-3 mt-1">
                <dt className="text-[10px] uppercase tracking-[0.18em] text-ink font-semibold">{copy.lineTotal}</dt>
                <dd className="font-display text-xl text-ink text-right">{usd(c.total)}</dd>
              </div>
              {!c.isTraditional && (
                <div className="flex items-baseline justify-between gap-4">
                  <dt className="text-[10px] uppercase tracking-[0.18em] text-gold font-semibold">{copy.lineSavings}</dt>
                  <dd className="font-display italic text-2xl text-gold text-right">{usd(c.savings)}</dd>
                </div>
              )}
            </dl>
          </li>
        ))}
      </ul>
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm border border-gold-soft">
          <thead>
            <tr className="bg-ivory-strong/40">
              <th className="text-left p-3 w-1/5" />
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={`${headerCell} ${c.isTraditional ? "text-ink/55" : "text-gold"}`}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {/* UPFRONT */}
            <tr>
              <td colSpan={columns.length + 1} className={sectionRow}>
                {copy.upfrontHeader}
              </td>
            </tr>
            <tr className="border-t border-gold-soft/60">
              <td className={labelCell}>
                {copy.lineListingFee}{" "}
                <InfoTip label={copy.infoAriaLabel} text={copy.tipListingFee} />
              </td>
              {columns.map((c) => (
                <td key={c.key} className={moneyCell}>
                  {usd(c.listingFee)}
                </td>
              ))}
            </tr>
            <tr className="border-t border-gold-soft/60">
              <td className={labelCell}>
                {copy.linePhotos}{" "}
                <InfoTip label={copy.infoAriaLabel} text={copy.tipPhotos} />
              </td>
              {columns.map((c) => (
                <td key={c.key} className={moneyCell}>
                  {c.photos === null ? (
                    <span className="text-ink/60 italic">{c.photosText}</span>
                  ) : (
                    usd(c.photos)
                  )}
                </td>
              ))}
            </tr>
            <tr className="border-t border-gold-soft/60">
              <td className={labelCell}>
                {copy.lineDocusign}{" "}
                <InfoTip label={copy.infoAriaLabel} text={copy.tipDocusign} />
              </td>
              {columns.map((c) => (
                <td key={c.key} className={moneyCell}>
                  {c.docusign === null ? (
                    <span className="text-ink/60 italic">{copy.included}</span>
                  ) : (
                    usd(c.docusign)
                  )}
                </td>
              ))}
            </tr>
            <tr className="border-t border-gold-soft bg-ivory-strong/20">
              <td className="p-3 text-[10px] uppercase tracking-[0.18em] text-ink/70 font-semibold">
                {copy.lineUpfrontSubtotal}{" "}
                <InfoTip
                  label={copy.infoAriaLabel}
                  text={copy.tipUpfrontSubtotal}
                />
              </td>
              {columns.map((c) => (
                <td key={c.key} className="p-3 text-right text-ink font-medium">
                  {usd(c.upfront)}
                </td>
              ))}
            </tr>

            {/* CLOSING */}
            <tr>
              <td colSpan={columns.length + 1} className={sectionRow}>
                {copy.closingHeader}
              </td>
            </tr>
            <tr className="border-t border-gold-soft/60">
              <td className={labelCell}>
                {copy.lineSellerCommission}{" "}
                <InfoTip
                  label={copy.infoAriaLabel}
                  text={copy.tipSellerCommission}
                />
              </td>
              {columns.map((c) => (
                <td key={c.key} className={moneyCell}>
                  {usd(c.sellerComm)}
                  <span className={pctTag}>({c.sellerPct}%)</span>
                </td>
              ))}
            </tr>
            <tr className="border-t border-gold-soft/60">
              <td className={labelCell}>
                {copy.lineBuyerCommission}{" "}
                <InfoTip
                  label={copy.infoAriaLabel}
                  text={copy.tipBuyerCommission}
                />
                <span className="block text-[10px] text-ink/45 not-italic mt-0.5">
                  {copy.youSelected} {buyerShown}
                </span>
              </td>
              {columns.map((c) => (
                <td key={c.key} className={moneyCell}>
                  {usd(c.buyer)}
                  <span className={pctTag}>({c.buyerShown})</span>
                </td>
              ))}
            </tr>
            <tr className="border-t border-gold-soft bg-ivory-strong/20">
              <td className="p-3 text-[10px] uppercase tracking-[0.18em] text-ink/70 font-semibold">
                {copy.lineClosingSubtotal}{" "}
                <InfoTip
                  label={copy.infoAriaLabel}
                  text={copy.tipClosingSubtotal}
                />
              </td>
              {columns.map((c) => (
                <td key={c.key} className="p-3 text-right text-ink font-medium">
                  {usd(c.closing)}
                </td>
              ))}
            </tr>

            {/* TOTAL */}
            <tr className="border-t-2 border-gold-soft bg-ivory-strong/40">
              <td className="p-3 text-[10px] uppercase tracking-[0.18em] text-ink font-semibold">
                {copy.lineTotal}{" "}
                <InfoTip label={copy.infoAriaLabel} text={copy.tipTotal} />
              </td>
              {columns.map((c) => (
                <td
                  key={c.key}
                  className="p-3 text-right font-display text-lg text-ink"
                >
                  {usd(c.total)}
                </td>
              ))}
            </tr>
            {/* YOU SAVE */}
            <tr className="border-t border-gold-soft bg-gold/5">
              <td className="p-3 text-[10px] uppercase tracking-[0.18em] text-gold font-semibold">
                {copy.lineSavings}{" "}
                <InfoTip label={copy.infoAriaLabel} text={copy.tipSavings} />
              </td>
              {columns.map((c) => (
                <td
                  key={c.key}
                  className="p-3 text-right font-display italic text-xl text-gold"
                >
                  {c.isTraditional ? (
                    <span className="text-ink/40 text-sm not-italic">—</span>
                  ) : (
                    usd(c.savings)
                  )}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      </div>

      {/* Key insight */}
      <div className="border-l-2 border-gold bg-gold/5 px-5 py-4 flex flex-col gap-1">
        <span className="text-[10px] uppercase tracking-[0.22em] text-gold font-semibold">
          {copy.keyInsightLabel}
        </span>
        <p className="text-sm text-ink leading-relaxed">{keyInsightText}</p>
      </div>

      {/* Explanation */}
      <details className="border border-gold-soft bg-ivory-strong/30 p-5">
        <summary className="cursor-pointer text-[10px] uppercase tracking-[0.22em] text-gold font-semibold">
          {copy.howToRead}
        </summary>
        <p className="text-xs text-ink/70 leading-relaxed mt-3">
          {copy.howToReadBody}
        </p>
      </details>
    </div>
  );
}
