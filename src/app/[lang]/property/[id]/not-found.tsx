"use client";

// Respaldo del 404 de la ficha (#135). Normalmente el proxy responde 404/410 antes de
// llegar aquí; esta vista solo aparece si esa consulta falló. Next añade
// <meta name="robots" content="noindex"> a toda respuesta de notFound(). Sin datos del
// listing. Copia local (no i18n.ts) para no cargar todos los diccionarios en el cliente.
import Link from "next/link";
import { useParams } from "next/navigation";

const COPY = {
  en: {
    title: "Listing not found",
    body: "This property is no longer active or never existed.",
    back: "Back to listings",
  },
  es: {
    title: "Listing no encontrado",
    body: "Esta propiedad ya no está activa o nunca existió.",
    back: "Volver a listings",
  },
} as const;

export default function PropertyNotFound() {
  const params = useParams<{ lang?: string }>();
  const lang = params?.lang === "es" ? "es" : "en";
  const copy = COPY[lang];
  return (
    <main className="bg-background text-foreground flex-1 flex items-center justify-center px-6 py-32">
      <div className="max-w-md text-center flex flex-col items-center gap-6">
        <h1 className="font-display text-4xl text-ink font-normal">{copy.title}</h1>
        <p className="text-base text-ink/70">{copy.body}</p>
        <Link
          href={`/${lang}/properties`}
          className="text-[10px] uppercase tracking-[0.22em] text-gold"
        >
          {copy.back}
        </Link>
      </div>
    </main>
  );
}
