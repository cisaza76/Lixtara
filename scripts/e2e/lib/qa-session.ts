// Sesión autenticada de la cuenta QA para el arnés E2E.
//
// NUNCA usa la cuenta ni las cookies de una persona real: lee E2E_QA_EMAIL / E2E_QA_PASSWORD
// del entorno y jamás los imprime, registra ni devuelve. El password no aparece en ningún
// log, error ni resultado.
//
// Las cookies NO se fabrican a mano. Se usa el MISMO `createServerClient` de @supabase/ssr
// que usa la app, con un almacén en memoria: la librería produce exactamente el formato que
// el servidor espera (nombre, chunking, codificación). Si Supabase cambia ese formato, el
// arnés sigue funcionando sin tocarlo.
import { createServerClient, type CookieOptions } from "@supabase/ssr";

interface Cookie {
  name: string;
  value: string;
  options?: CookieOptions;
}

export interface QaSession {
  userId: string;
  /** Cabecera lista para `fetch` contra la app. */
  cookieHeader: string;
  /** Para inyectar en un navegador (Playwright `context.addCookies`). */
  cookies: { name: string; value: string; domain: string; path: string }[];
}

function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `Falta ${name}. Defínela en .env.local (nunca en el repositorio ni en la línea de comandos).`,
    );
  }
  return v;
}

export async function createQaSession(appOrigin: string): Promise<QaSession> {
  const url = requiredEnv("NEXT_PUBLIC_SUPABASE_URL");
  const anon = requiredEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  const email = requiredEnv("E2E_QA_EMAIL");
  const password = requiredEnv("E2E_QA_PASSWORD"); // jamás se imprime

  if (!email.endsWith("@lixtara-test.invalid")) {
    // Barrera dura: el arnés SOLO puede autenticarse como una cuenta de prueba del TLD
    // reservado. Impide por construcción que un .env mal configurado lo apunte a una
    // cuenta real de vendedor.
    throw new Error(
      `E2E_QA_EMAIL debe pertenecer a @lixtara-test.invalid (recibido: ${email}). ` +
        `El arnés nunca opera sobre cuentas reales.`,
    );
  }

  const jar = new Map<string, Cookie>();
  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll: () => [...jar.values()].map(({ name, value }) => ({ name, value })),
      setAll: (toSet) => toSet.forEach((c) => jar.set(c.name, c)),
    },
  });

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) {
    // El mensaje del proveedor puede repetir el email, nunca el password.
    throw new Error(`Autenticación QA fallida: ${error?.message ?? "sin sesión"}`);
  }

  const host = new URL(appOrigin).hostname;
  return {
    userId: data.user.id,
    cookieHeader: [...jar.values()].map((c) => `${c.name}=${c.value}`).join("; "),
    cookies: [...jar.values()].map((c) => ({ name: c.name, value: c.value, domain: host, path: "/" })),
  };
}
