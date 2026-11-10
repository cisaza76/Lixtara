/**
 * Teléfono para mostrar (correos internos, contrato). Un número de EE. UU. (10 dígitos, u 11 que
 * empiezan por 1, con o sin "+", espacios, guiones, puntos o paréntesis) sale como
 * "+1 (305) 522-3454". Cualquier otro (otro país, texto raro) sale tal como vino, recortado.
 * Vacío o null → "".
 */
export function formatUsPhone(raw: string | null | undefined): string {
  const s = (raw ?? "").trim();
  const d = s.replace(/\D/g, "");
  const us = d.length === 10 ? d : d.length === 11 && d.startsWith("1") ? d.slice(1) : null;
  return us && /^\+?[0-9 ().-]+$/.test(s) ? `+1 (${us.slice(0, 3)}) ${us.slice(3, 6)}-${us.slice(6)}` : s;
}
