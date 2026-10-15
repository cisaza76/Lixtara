// Contadores del panel del vendedor.

/**
 * "En proceso": todo lo que aún no está publicado ni cerrado. Incluye el listing pagado
 * que espera la revisión de la broker (`pending_approval`), no solo los borradores.
 */
export const IN_PROGRESS_STATUSES: ReadonlySet<string> = new Set(["draft", "pending_approval"]);

export function inProgressCount(listings: ReadonlyArray<{ mls_status: string | null }>): number {
  return listings.filter((l) => l.mls_status !== null && IN_PROGRESS_STATUSES.has(l.mls_status)).length;
}
