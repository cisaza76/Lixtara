import { describe, expect, it } from "vitest";
import { checkoutUsdValue } from "@/lib/checkout-amount";

// Sesión del plan Pro cobrada en COP por Adaptive Pricing (montos en centavos de cada moneda).
const converted = {
  amount_total: 198_000_000,
  currency: "cop",
  currency_conversion: { amount_subtotal: 49500, amount_total: 49500, fx_rate: "4000", source_currency: "usd" },
};

describe("checkoutUsdValue: el valor de los eventos siempre en USD", () => {
  it("sesión convertida (Adaptive Pricing, COP): el total y la moneda de origen", () => {
    expect(checkoutUsdValue(converted)).toBe(495);
  });
  it("sin conversión: amount_total si la sesión es en USD", () => {
    expect(checkoutUsdValue({ amount_total: 49500, currency: "usd" })).toBe(495);
    expect(checkoutUsdValue({ amount_total: 49500, currency: "USD", currency_conversion: null })).toBe(495);
  });
  it("sin forma de saberlo en USD: null (nunca un valor en otra moneda)", () => {
    expect(checkoutUsdValue({ amount_total: 198_000_000, currency: "cop" })).toBeNull();
    expect(
      checkoutUsdValue({ ...converted, currency_conversion: { ...converted.currency_conversion, source_currency: "eur" } }),
    ).toBeNull();
    expect(checkoutUsdValue({ amount_total: null, currency: "usd" })).toBeNull();
  });
});
