// Limpieza de datos de prueba antes del lanzamiento: qué se borra y en qué orden. La usa
// scripts/cleanup/prelaunch-test-data.ts (solo lectura por defecto). Lógica pura, con prueba.

/** Correo de prueba: "+lxtest", "+smtptest" o "qa" como palabra al inicio de una parte. */
export function isTestEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const local = email.toLowerCase().split("@")[0] ?? "";
  if (local.includes("+lxtest") || local.includes("+smtptest")) return true;
  // qa@…, qa-lang-123@…, qatest@…, camilo+qa@…, test.qa@… — no "aqaba" ni "sequoia".
  return /(^|[^a-z])qa/.test(local);
}

export interface CleanupAccount {
  id: string;
  email: string | null;
}
export interface CleanupProperty {
  id: string;
  owner_id: string | null;
  is_test: boolean;
}

export interface CleanupPlan {
  /** Cuentas que se borran (correo de prueba y sin listings reales). */
  accounts: CleanupAccount[];
  /** Cuentas con correo de prueba que son dueñas de un listing NO marcado is_test: no se tocan. */
  accountsToReview: Array<CleanupAccount & { realPropertyIds: string[] }>;
  /** Listings que se borran: is_test, o de una cuenta que se borra. */
  properties: CleanupProperty[];
}

export function buildCleanupPlan(accounts: CleanupAccount[], properties: CleanupProperty[]): CleanupPlan {
  const testAccounts = accounts.filter((a) => isTestEmail(a.email));
  const realByOwner = new Map<string, string[]>();
  for (const p of properties) {
    if (!p.is_test && p.owner_id) realByOwner.set(p.owner_id, [...(realByOwner.get(p.owner_id) ?? []), p.id]);
  }
  const accountsToReview = testAccounts
    .filter((a) => realByOwner.has(a.id))
    .map((a) => ({ ...a, realPropertyIds: realByOwner.get(a.id)! }));
  const toDelete = testAccounts.filter((a) => !realByOwner.has(a.id));
  const deleteIds = new Set(toDelete.map((a) => a.id));
  return {
    accounts: toDelete,
    accountsToReview,
    properties: properties.filter((p) => p.is_test || (p.owner_id !== null && deleteIds.has(p.owner_id))),
  };
}

/**
 * Tablas que apuntan a properties o a users SIN borrado en cascada (baseline 2026-05-20): sus
 * filas se borran antes que el listing o la cuenta, o el borrado falla. Las demás tablas
 * tienen ON DELETE CASCADE o SET NULL.
 */
export const PROPERTY_DEPENDENTS: Array<{ table: string; column: string }> = [
  { table: "activity_log", column: "property_id" },
  { table: "broker_tasks", column: "property_id" },
  { table: "documents", column: "property_id" },
  { table: "listing_agreements", column: "property_id" },
  { table: "notifications", column: "related_property_id" },
  { table: "payments", column: "property_id" },
  { table: "transactions", column: "property_id" },
];

export const USER_DEPENDENTS: Array<{ table: string; column: string }> = [
  { table: "activity_log", column: "user_id" },
  { table: "broker_tasks", column: "assigned_to" },
  { table: "documents", column: "uploaded_by" },
  { table: "listing_agreements", column: "seller_id" },
  { table: "notifications", column: "user_id" },
  { table: "payments", column: "user_id" },
  { table: "transactions", column: "buyer_id" },
  { table: "transactions", column: "seller_id" },
];

/** Frase que hay que escribir para confirmar el borrado (con los números exactos). */
export function confirmationPhrase(plan: CleanupPlan): string {
  return `BORRAR ${plan.properties.length} LISTINGS Y ${plan.accounts.length} CUENTAS`;
}
