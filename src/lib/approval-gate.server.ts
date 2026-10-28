// Lo que impide aprobar un listing (pending_approval → active), en un solo lugar para las dos
// pantallas del admin (inicio y /admin/listings/[id]/review). En orden: listing de prueba,
// descripción legal sin verificar (#217), titular (#220) y la contrafirma de la broker, en vivo
// con DocuSign (el acuerdo tiene que estar completo: firmaron todos los vendedores y la broker).
// Falla cerrado: lo que no se puede leer bloquea.

import type { SupabaseClient } from "@supabase/supabase-js";
import { checkBrokerCountersigned } from "@/lib/agreement-refresh";
import { pendingLegalByProperty } from "@/lib/agreement-legal.server";
import { isTestListing, TEST_LISTING_ERROR } from "@/lib/listing-approval.server";
import { ownershipGateFor } from "@/lib/listing-signers-admin.server";

export interface ApprovalGateDeps {
  isTestListing: typeof isTestListing;
  pendingLegal: (id: string) => Promise<boolean>;
  ownershipGate: typeof ownershipGateFor;
  countersigned: typeof checkBrokerCountersigned;
}

const defaultDeps: ApprovalGateDeps = {
  isTestListing,
  pendingLegal: async (id) => (await pendingLegalByProperty([id])).has(id),
  ownershipGate: ownershipGateFor,
  countersigned: checkBrokerCountersigned,
};

/** null = se puede aprobar; si no, el código de error (?error=…) de las dos pantallas. */
export async function approvalBlocker(
  supabase: SupabaseClient,
  id: string,
  deps: ApprovalGateDeps = defaultDeps,
): Promise<string | null> {
  if (await deps.isTestListing(supabase, id)) return TEST_LISTING_ERROR;
  if (await deps.pendingLegal(id)) return "legal_pending";
  const owner = await deps.ownershipGate(id);
  if (!owner.ok) return owner.reason;
  const gate = await deps.countersigned(id);
  if (!gate.ok) return gate.reason;
  return null;
}
