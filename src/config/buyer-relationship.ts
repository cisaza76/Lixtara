// Relación con el comprador (decisión del owner, 2026-10-28). ÚNICA fuente del texto que
// reemplaza en todo el sitio (páginas, listados, correos, Loui) cualquier promesa de
// acompañar o representar al comprador. Lixtara representa al vendedor; un comprador sin
// agente se atiende como No Brokerage Relationship (F.S. 475.278(4), src/lib/nbr-notice.ts).
// buyer-relationship.test.ts falla si vuelve una promesa de acompañamiento.

export const BUYER_SELLER_SIDE_LINE = {
  en: "Lixtara represents the seller. If you do not have an agent, we can show you the property and receive your offer, but we do not represent you and will not advise you in negotiating against the seller. We recommend consulting your own agent or attorney.",
  es: "Lixtara representa al vendedor. Si usted no tiene agente, podemos mostrarle la propiedad y recibir su oferta, pero no lo representamos: no le daremos asesoría para negociar contra el vendedor. Le recomendamos consultar a su propio agente o abogado.",
} as const;

export function buyerSellerSideLine(lang: string): string {
  return BUYER_SELLER_SIDE_LINE[lang === "es" ? "es" : "en"];
}
