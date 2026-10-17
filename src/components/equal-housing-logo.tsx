// Logotipo de Equal Housing Opportunity (casa con signo igual), dibujado en SVG para no
// depender de un archivo externo. [VERIFICAR con el abogado: que el dibujo cumpla la guía
// de HUD para el logotipo (24 CFR Part 110) o reemplazarlo por el arte oficial.]
export function EqualHousingLogo({ label, className = "w-5 h-5" }: { label: string; className?: string }) {
  return (
    <svg viewBox="0 0 32 32" role="img" aria-label={label} className={className} fill="none">
      <title>{label}</title>
      <path d="M16 3 2 14h4v15h20V14h4L16 3Z" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" />
      <rect x="10" y="16" width="12" height="2.6" fill="currentColor" />
      <rect x="10" y="21.4" width="12" height="2.6" fill="currentColor" />
    </svg>
  );
}
