import { describe, it, expect } from "vitest";
import { isFirstSession } from "./first-session";

describe("isFirstSession (saludo del panel)", () => {
  it("la sesión que abre la confirmación del correo es la primera", () => {
    expect(isFirstSession({ email_confirmed_at: "2026-10-18T15:00:00Z", last_sign_in_at: "2026-10-18T15:00:01Z" })).toBe(true);
  });

  it("cuenta del paso 7: la sesión anónima empezó antes de confirmar el correo", () => {
    expect(isFirstSession({ email_confirmed_at: "2026-10-18T15:00:00Z", last_sign_in_at: "2026-10-18T14:10:00Z" })).toBe(true);
  });

  it("un ingreso posterior es 'de vuelta'", () => {
    expect(isFirstSession({ email_confirmed_at: "2026-10-18T15:00:00Z", last_sign_in_at: "2026-10-19T09:00:00Z" })).toBe(false);
  });

  it("sin datos de confirmación o de ingreso: primera vez", () => {
    expect(isFirstSession({ last_sign_in_at: "2026-10-18T15:00:00Z" })).toBe(true);
    expect(isFirstSession({ email_confirmed_at: "2026-10-18T15:00:00Z" })).toBe(true);
  });
});
