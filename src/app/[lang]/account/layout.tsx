import type { ReactNode } from "react";

// Respaldo de máscara (decisión del owner 2026-10-16): Clarity no graba /account (el
// contenedor la excluye en la carga y RecordingGuard fuerza la carga completa al entrar),
// pero si alguna navegación la alcanzara grabando, todo el contenido sale enmascarado.
// `contents`: el envoltorio no participa del layout (la página sigue siendo hija del <body>).
export default function AccountLayout({ children }: { children: ReactNode }) {
  return (
    <div data-clarity-mask="true" className="contents">
      {children}
    </div>
  );
}
