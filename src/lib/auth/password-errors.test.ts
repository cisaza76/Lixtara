import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { AuthWeakPasswordError } from "@supabase/supabase-js";
import { passwordRejection } from "@/lib/auth/password-errors";
import { t } from "@/lib/i18n";

describe("contraseñas filtradas (Supabase: Prevent use of leaked passwords)", () => {
  it("el error REAL de auth-js con reasons ['pwned'] → leaked; otras razones → weak", () => {
    const pwned = new AuthWeakPasswordError("Password is known to be weak and easy to guess, please choose a different one.", 422, ["pwned"]);
    expect(pwned.code).toBe("weak_password");
    expect(passwordRejection(pwned)).toBe("leaked");
    expect(passwordRejection(new AuthWeakPasswordError("x", 422, ["length", "pwned"]))).toBe("leaked");
    expect(passwordRejection(new AuthWeakPasswordError("x", 422, ["characters"]))).toBe("weak");
  });

  it("otros errores no son de la contraseña", () => {
    expect(passwordRejection(null)).toBeNull();
    expect(passwordRejection(new Error("network"))).toBeNull();
    expect(passwordRejection({ code: "captcha_failed" })).toBeNull();
    expect(passwordRejection({ code: "email_exists", message: "already registered" })).toBeNull();
  });

  it("mensaje claro en EN y ES", () => {
    expect(t("es").auth.errors.leakedPassword).toBe("Esta contraseña apareció en una filtración de datos; elige otra.");
    expect(t("en").auth.errors.leakedPassword).toBe("This password appeared in a data breach. Choose a different one.");
  });

  it.each([
    ["src/app/[lang]/sign-up/page.tsx", 'sp.error === "leaked_password"'],
    ["src/app/[lang]/auth/reset-password/page.tsx", 'sp.error === "leaked"'],
    ["src/app/[lang]/account/page.tsx", "leaked: t(lang).auth.errors.leakedPassword"],
    ["src/app/[lang]/listing/new/page.tsx", "errLeaked: t(lang).auth.errors.leakedPassword"],
  ])("%s distingue la contraseña filtrada", (file, needle) => {
    const src = readFileSync(file, "utf8");
    expect(src).toContain("passwordRejection");
    expect(src).toContain(needle);
  });

  it("paso 7: las dos llamadas a updateUser con contraseña pasan por passwordErrorKey", () => {
    const page = readFileSync("src/app/[lang]/listing/new/page.tsx", "utf8");
    expect(page).toContain("redirect(`${back}&aerror=${passwordErrorKey(pwError) ?? \"failed\"}`)");
    expect(page).toMatch(/passwordErrorKey\(error\) \?\?\s*\(\/registered\|already\/i/);
    const gate = readFileSync("src/components/account-gate.tsx", "utf8");
    expect(gate).toContain('case "leaked":\n      return labels.errLeaked;');
  });
});
