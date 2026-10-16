// Paso 1: si el envío vuelve con error (correo ya registrado, correo inválido, captcha,
// fuera de Florida…), el formulario NO se vacía. Lo escrito viaja en una cookie httpOnly
// corta, limitada a /[lang]/listing/new, nunca en la URL (dirección y correo son datos
// personales). suggested_tier no es personal: sigue en la URL, como cuando llegó.
// La misma cookie sobrevive a "Iniciar sesión" desde el error de correo existente: el
// regreso (`restore=1`) vuelve a llenar el paso 1. 30 min alcanzan para iniciar sesión.

export const STEP1_FORM_COOKIE = "lx_step1_form";
export const STEP1_FORM_MAX_AGE_S = 30 * 60;

const TIERS = ["essentials", "pro", "concierge"] as const;

export interface Step1Form {
  street: string;
  unit: string;
  city: string;
  zip: string;
  lat: string;
  lng: string;
  email: string;
}

const LIMITS: Record<keyof Step1Form, number> = {
  street: 200,
  unit: 40,
  city: 100,
  zip: 10,
  lat: 20,
  lng: 20,
  email: 254,
};

export function encodeStep1Form(form: Partial<Step1Form>): string {
  const out: Partial<Step1Form> = {};
  for (const k of Object.keys(LIMITS) as Array<keyof Step1Form>) {
    const v = String(form[k] ?? "").trim().slice(0, LIMITS[k]);
    if (v) out[k] = v;
  }
  return JSON.stringify(out);
}

/** Valor de la cookie → campos (cadenas vacías si falta algo o el valor no es válido). */
export function decodeStep1Form(raw: string | undefined | null): Step1Form | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return null;
    const out = {} as Step1Form;
    for (const k of Object.keys(LIMITS) as Array<keyof Step1Form>) {
      const v = parsed[k];
      out[k] = typeof v === "string" ? v.slice(0, LIMITS[k]) : "";
    }
    return out;
  } catch {
    return null;
  }
}

/** Solo un plan válido sobrevive en la URL de vuelta. */
export function suggestedTierParam(raw: unknown, tiers: readonly string[]): string {
  return typeof raw === "string" && tiers.includes(raw) ? `&suggested_tier=${raw}` : "";
}

/**
 * "Iniciar sesión" desde el paso 1: el regreso conserva el idioma, el plan sugerido y,
 * con `restore=1`, lo escrito (cookie). El `next` va codificado, si no su `?` y su `&`
 * se pierden en la URL de /sign-in.
 */
export function step1SignInHref(lang: string, suggestedTier: unknown): string {
  const next = `/${lang}/listing/new?step=1${suggestedTierParam(suggestedTier, TIERS)}&restore=1`;
  return `/${lang}/sign-in?next=${encodeURIComponent(next)}`;
}
