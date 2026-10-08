import { notFound } from "next/navigation";

// Cualquier ruta sin página bajo /[lang] cae aquí, para que el 404 se muestre dentro del
// layout del idioma (src/app/[lang]/not-found.tsx) en vez del 404 genérico en inglés.
export default function CatchAllNotFound() {
  notFound();
}
