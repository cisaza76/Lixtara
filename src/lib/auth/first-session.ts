// ¿Es el primer ingreso de esta cuenta? Decide el saludo del panel ("Bienvenido" la primera
// vez, "Bienvenido de vuelta" después) sin escribir nada en la base.
//
// Confirmar el correo (código de /sign-up o del paso 7) abre la sesión en ese momento, así que
// en el primer ingreso `last_sign_in_at` es anterior a la confirmación o la sigue por pocos
// minutos. Un ingreso posterior con contraseña o enlace mueve `last_sign_in_at` más allá.
//
// PURO: sin I/O.

/** Margen entre la confirmación del correo y el inicio de sesión que abre (verifyOtp). */
export const FIRST_SESSION_WINDOW_MS = 5 * 60 * 1000;

export function isFirstSession(user: {
  email_confirmed_at?: string | null;
  confirmed_at?: string | null;
  last_sign_in_at?: string | null;
}): boolean {
  const confirmed = user.email_confirmed_at ?? user.confirmed_at ?? null;
  if (!confirmed || !user.last_sign_in_at) return true;
  const c = Date.parse(confirmed);
  const s = Date.parse(user.last_sign_in_at);
  if (Number.isNaN(c) || Number.isNaN(s)) return false;
  return s <= c + FIRST_SESSION_WINDOW_MS;
}
