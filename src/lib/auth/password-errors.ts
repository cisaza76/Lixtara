// Contraseñas que Supabase Auth rechaza al crearlas o cambiarlas (signUp, updateUser).
// Con "Prevent use of leaked passwords" activo (HaveIBeenPwned), Supabase responde
// AuthWeakPasswordError: status 422, code "weak_password" y `reasons` con "pwned". Las
// otras razones ("length", "characters") salen de la política de largo y caracteres.
// Verificado en @supabase/auth-js 2.105.4 (lib/errors.d.ts, lib/types.d.ts).

/**
 * Largo mínimo de una contraseña nueva: el `minLength` de cada campo (sign-up, paso 7, reset y
 * cambio en /account) y la comprobación de su server action leen este número.
 */
export const PASSWORD_MIN_LENGTH = 8;

export type PasswordRejection = "leaked" | "weak";

/** null = el error no es de la contraseña (red, captcha, correo existente…). */
export function passwordRejection(error: unknown): PasswordRejection | null {
  if (!error || typeof error !== "object") return null;
  const e = error as { code?: unknown; name?: unknown; reasons?: unknown };
  if (e.code !== "weak_password" && e.name !== "AuthWeakPasswordError") return null;
  return Array.isArray(e.reasons) && e.reasons.includes("pwned") ? "leaked" : "weak";
}
