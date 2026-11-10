// Aviso interno del guard de producción (src/lib/docusign-demo-guard.ts): a Camilo
// (BROKER_NOTIFICATION_EMAIL) y a la broker (BROKER_SIGNER_EMAIL), con el listing y el contacto
// del vendedor. Un aviso por listing, destinatario y día en Miami (idempotencyKey de Resend), así
// que los clics repetidos del vendedor no lo repiten. Nunca lanza: el vendedor ve su mensaje igual.
import { BROKER_SIGNER_EMAIL } from "@/config/brokerage";
import { sendContractPreparingInternal, type ContractPreparingInternalInput } from "@/lib/email";

/** Destinatarios únicos (sin distinguir mayúsculas). */
export function contractPreparingRecipients(env: NodeJS.ProcessEnv = process.env): string[] {
  const all = [env.BROKER_NOTIFICATION_EMAIL ?? "camilo.isaza@gmail.com", BROKER_SIGNER_EMAIL];
  const seen = new Set<string>();
  return all.filter((e): e is string => {
    if (!e || seen.has(e.toLowerCase())) return false;
    seen.add(e.toLowerCase());
    return true;
  });
}

/** "2026-11-10": el día en Miami, para la clave de un aviso por día. */
export function miamiDay(now: Date): string {
  return now.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

export async function notifyContractPreparing(
  input: Omit<ContractPreparingInternalInput, "to" | "idempotencyKey">,
  now: Date = new Date(),
): Promise<void> {
  const day = miamiDay(now);
  await Promise.all(
    contractPreparingRecipients().map(async (to) => {
      try {
        const r = await sendContractPreparingInternal({
          ...input,
          to,
          idempotencyKey: `contract-preparing:${input.propertyId}:${to.toLowerCase()}:${day}`,
        });
        if (!r.ok) console.error(JSON.stringify({ event: "contract_preparing_email_failed", property_id: input.propertyId, error: r.error }));
      } catch (e) {
        console.error(JSON.stringify({ event: "contract_preparing_email_failed", property_id: input.propertyId, error: e instanceof Error ? e.message : String(e) }));
      }
    }),
  );
}
