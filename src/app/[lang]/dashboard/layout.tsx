import type { ReactNode } from "react";

// El panel del vendedor muestra las fotos, los videos y los pagos de sus listados. Clarity
// lo puede grabar (no está excluido en el contenedor), pero sin mostrar nada de eso: todo
// el contenido va enmascarado. Los clics se siguen registrando por posición.
// `contents`: el envoltorio no participa del layout.
export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div data-clarity-mask="true" className="contents">
      {children}
    </div>
  );
}
