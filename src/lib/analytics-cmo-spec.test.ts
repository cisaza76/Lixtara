// Spec de eventos del embudo del CMO (2026-10-19 y 10-20, GTM-5KGLHNL4 v12): nombres y valores que
// GTM y GA4 esperan tal cual. Cambiar uno parte los datos en dos: avisar al CMO antes.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

describe("eventos del embudo según la spec del CMO", () => {
  it("calculator_used: una vez por visita, con home_price_range y commission_mode, sin montos ni plan", () => {
    const src = read("src/components/savings-slider.tsx");
    expect(src).toContain('event: "calculator_used"');
    expect(src).toContain("home_price_range: homePriceRange(price)");
    expect(src).toContain("commission_mode: offer.type");
    expect(src).toContain("calculatorUsedThisVisit()");
    expect(src).not.toMatch(/buyer_commission_pct|buyer_comp_type|\bplan:/);
  });

  it("begin_checkout: value = la tarifa del plan que cobra Stripe, USD, y redirige aunque GTM no responda", () => {
    expect(read("src/app/[lang]/listing/new/page.tsx")).toContain("value={isPlanTier(draft?.pricing_tier) ? PRICING_TIERS[draft.pricing_tier].flatFee : null}");
    expect(read("src/lib/stripe.ts")).toContain("const amountCents = tier.flatFee * 100;");
    expect(read("src/components/checkout-button.tsx")).toContain('currency: "USD", lang }, go);');
  });

  it("listing_resumed: el panel marca account; los enlaces para retomar, email_link o broker_link y nunca UTM", () => {
    const gate = read("src/lib/listing-email-gate.ts");
    expect(gate).toContain("const marker = source ? `&resumed=${source}` : \"\";");
    expect(gate).not.toMatch(/utm_/);
    const dash = read("src/app/[lang]/dashboard/page.tsx");
    expect(dash.match(/&step=6&resumed=account/g)).toHaveLength(2);
    expect(read("src/components/listing-funnel-events.tsx")).toContain('"direct"');
  });

  it("agreement_signed: una vez por listing en la pestaña, solo con la firma confirmada", () => {
    const src = read("src/components/listing-funnel-events.tsx");
    expect(src).toMatch(/params\.get\("signed"\) === "1" && agreementSigned\) \{\s*if \(firstSignedReport\(listingId\)\)/);
  });
});
