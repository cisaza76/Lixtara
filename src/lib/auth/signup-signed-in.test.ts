import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { signedInPanelPath } from "@/lib/auth/listing-session.server";

// /sign-up con sesión iniciada va al panel en vez de mostrar el formulario.
const verified = { is_anonymous: false, email: "a@example.com", email_confirmed_at: "2026-10-17T00:00:00Z", user_metadata: {} };

describe("/sign-up con sesión iniciada", () => {
  it("cuenta real → panel del vendedor, en su idioma", () => {
    expect(signedInPanelPath(verified, "es", false)).toBe("/es/dashboard");
    expect(signedInPanelPath(verified, "en", false)).toBe("/en/dashboard");
  });
  it("admin o broker → /admin", () => {
    expect(signedInPanelPath(verified, "en", true)).toBe("/en/admin");
  });
  it("sin sesión, anónima, sin confirmar o con cuenta pendiente del paso 1 → muestra el formulario", () => {
    expect(signedInPanelPath(null, "en", false)).toBeNull();
    expect(signedInPanelPath({ ...verified, is_anonymous: true, email: undefined, email_confirmed_at: undefined }, "en", false)).toBeNull();
    expect(signedInPanelPath({ ...verified, email_confirmed_at: undefined }, "en", false)).toBeNull();
    expect(signedInPanelPath({ ...verified, user_metadata: { account_pending: true } }, "en", false)).toBeNull();
  });
  it("la página lo aplica después de devolver la sesión del listado a su borrador", () => {
    const page = readFileSync(join(resolve(__dirname, "../../.."), "src/app/[lang]/sign-up/page.tsx"), "utf8");
    const a = page.indexOf("await returnListingSessionToDraft(lang);");
    const b = page.indexOf("await redirectSignedInToPanel(lang);");
    expect(a).toBeGreaterThan(-1);
    expect(b).toBeGreaterThan(a);
  });
});
