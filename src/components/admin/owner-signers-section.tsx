// "Titular y firmantes" de la revisión del listing en el admin (#220): el titular, cada firmante
// con su relación y el estado de su firma (en vivo desde DocuSign cuando responde), las marcas de
// Sunbiz / documento / revisión manual y el bloqueo por titular. Componente aparte para poder
// probar que se renderiza (listing-signers-section.test.ts).

import { formatMiamiDateTime } from "@/lib/mls-published";
import {
  canClearManualReview,
  ownershipGateMessage,
  sellerSignatureMissing,
  signersAdminCopy,
  sunbizSearchUrl,
  type OwnershipGate,
  type SignerLine,
  type StaffOwnership,
} from "@/lib/listing-signers-admin";
import { signersProgress } from "@/lib/admin-review-copy";

type Action = (formData: FormData) => void | Promise<void>;

function field(label: string, value: string | number | null | undefined) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-[0.18em] text-ink/55">{label}</span>
      <span className="text-sm text-ink">{value === null || value === undefined || value === "" ? "—" : value}</span>
    </div>
  );
}

export function OwnerSignersSection({
  lang,
  ownership,
  signerLines,
  hasAgreement,
  ownerGate,
  actions,
}: {
  lang: string;
  ownership: StaffOwnership | null;
  signerLines: SignerLine[];
  hasAgreement: boolean;
  ownerGate: OwnershipGate;
  actions: { markSunbizListed: Action; markSunbizNotListed: Action; markAuthorityDocument: Action; clearManualReview: Action };
}) {
  const sc = signersAdminCopy(lang);
  const progress = signersProgress(signerLines, lang);
  return (
    <section data-owner-signers className="border border-gold-soft p-6 flex flex-col gap-4">
      <span className="text-[10px] uppercase tracking-[0.18em] text-gold font-semibold">{sc.title}</span>
      {ownership ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
          {field(sc.kindLabel, sc.kind[ownership.owner_kind as keyof typeof sc.kind] ?? ownership.owner_kind)}
          {ownership.owner_kind !== "fl_entity" && field(sc.otherOnTitle, ownership.other_title_holders ? sc.yes : sc.no)}
          {ownership.owner_kind !== "fl_entity" && field(sc.marriedHomestead, ownership.married_homestead ? sc.yes : sc.no)}
          {ownership.owner_kind === "fl_entity" && field(sc.entity, ownership.entity_name)}
          {ownership.owner_kind === "fl_entity" && field(sc.signerTitle, ownership.entity_signer_title)}
          {ownership.owner_kind === "fl_entity" &&
            field(sc.authorityConfirmed, ownership.entity_authority_confirmed_at ? sc.yes : sc.no)}
          {ownership.owner_kind === "manual_review" &&
            field(sc.reason, sc.reasons[ownership.manual_review_reason ?? ""] ?? ownership.manual_review_reason)}
        </div>
      ) : (
        <p className="text-sm text-ink/55 italic">{sc.noOwnership}</p>
      )}

      <div className="flex flex-col gap-2">
        <span className="text-[10px] uppercase tracking-[0.18em] text-ink/55">
          {sc.signers}
          {progress && (
            <span data-signers-count className="ml-2 normal-case tracking-normal text-ink/70">
              {progress}
            </span>
          )}
        </span>
        <ul className="flex flex-col gap-1.5">
          {signerLines.map((l) => (
            <li key={l.role} data-signer={l.role} data-signer-status={l.status} className="text-sm text-ink flex flex-wrap gap-x-2">
              <strong className="font-medium">{sc.roles[l.role]}</strong>
              {l.name && <span>{l.name}</span>}
              <span className="text-ink/55">· {sc.relationships[l.relationship]}</span>
              <span className={l.status === "signed" ? "text-emerald-700" : "text-amber-700"}>· {sc.status[l.status]}</span>
            </li>
          ))}
        </ul>
        {hasAgreement && sellerSignatureMissing(signerLines) && <p className="text-xs text-amber-700">⚠️ {sc.sellerMissing}</p>}
      </div>

      {ownership?.owner_kind === "fl_entity" && ownership.entity_name && (
        <div className="flex flex-col gap-3 border-t border-gold-soft pt-4">
          <span className="text-[10px] uppercase tracking-[0.18em] text-ink/55">
            {sc.sunbiz} · <span data-sunbiz-status={ownership.sunbiz_status}>{sc.sunbizStatus[ownership.sunbiz_status as keyof typeof sc.sunbizStatus]}</span>
            {ownership.sunbiz_checked_at ? ` · ${sc.checkedOn} ${formatMiamiDateTime(ownership.sunbiz_checked_at)}` : ""}
          </span>
          <a
            href={sunbizSearchUrl(ownership.entity_name)}
            target="_blank"
            rel="noopener noreferrer"
            className="self-start text-sm text-ink underline decoration-gold underline-offset-4 hover:text-gold"
          >
            {sc.sunbizOpen}
          </a>
          <p className="text-xs text-ink/60">{sc.sunbizHelp}</p>
          <div className="flex flex-wrap gap-3">
            <form action={actions.markSunbizListed}>
              <button type="submit" disabled={ownership.sunbiz_status === "listed"} className="inline-flex items-center px-4 py-2 border border-gold-soft text-ink text-[10px] font-medium tracking-[0.2em] uppercase hover:border-gold disabled:opacity-40">
                {sc.markListed}
              </button>
            </form>
            <form action={actions.markSunbizNotListed}>
              <button type="submit" disabled={ownership.sunbiz_status === "not_listed"} className="inline-flex items-center px-4 py-2 border border-gold-soft text-ink text-[10px] font-medium tracking-[0.2em] uppercase hover:border-gold disabled:opacity-40">
                {sc.markNotListed}
              </button>
            </form>
          </div>
          {ownership.sunbiz_status === "not_listed" && (
            <div className="flex flex-col gap-2">
              <span className="text-[10px] uppercase tracking-[0.18em] text-ink/55">
                {sc.authorityDoc}
                {ownership.authority_document_received_at
                  ? ` · ${sc.docReceived} ${formatMiamiDateTime(ownership.authority_document_received_at)}`
                  : ""}
              </span>
              {!ownership.authority_document_received_at && (
                <>
                  <p className="text-xs text-ink/60">{sc.authorityDocHelp}</p>
                  <form action={actions.markAuthorityDocument}>
                    <button type="submit" className="inline-flex items-center px-4 py-2 border border-gold-soft text-ink text-[10px] font-medium tracking-[0.2em] uppercase hover:border-gold">
                      {sc.markDocReceived}
                    </button>
                  </form>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {ownership?.owner_kind === "manual_review" && (
        <div className="flex flex-col gap-2 border-t border-gold-soft pt-4">
          <span className="text-[10px] uppercase tracking-[0.18em] text-ink/55">
            {sc.manualReview}
            {ownership.manual_review_cleared_at ? ` · ${sc.cleared} ${formatMiamiDateTime(ownership.manual_review_cleared_at)}` : ""}
          </span>
          {!ownership.manual_review_cleared_at &&
            (canClearManualReview(ownership.manual_review_reason) ? (
              <>
                <p className="text-xs text-ink/60">{sc.manualReviewHelp}</p>
                <form action={actions.clearManualReview}>
                  <button type="submit" className="inline-flex items-center px-4 py-2 border border-gold-soft text-ink text-[10px] font-medium tracking-[0.2em] uppercase hover:border-gold">
                    {sc.clearManualReview}
                  </button>
                </form>
              </>
            ) : (
              <p className="text-xs text-ink/60">{sc.threeOwnersHelp}</p>
            ))}
        </div>
      )}

      {!ownerGate.ok && (
        <p data-owner-gate={ownerGate.reason} className="text-xs text-red-700">
          ⚠️ {ownershipGateMessage(ownerGate.reason, lang)}
        </p>
      )}
    </section>
  );
}
