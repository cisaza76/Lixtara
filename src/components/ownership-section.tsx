"use client";

// Paso 3: quién es el dueño y quién más firma el acuerdo (#220). Va dentro del <form> del paso
// 3; los campos que no aplican no se dibujan (no cuentan como obligatorios). Las reglas y la
// lectura del servidor: src/lib/listing-ownership.ts (parseOwnershipForm).
//
// El correo del segundo firmante lleva un `pattern` que rechaza el del vendedor: el navegador
// lo marca en el mismo intento que los demás errores, con "Cada firmante necesita su propio
// correo…" (invalidMessages de AppFormValidation). El servidor lo vuelve a comprobar.

import { useState } from "react";
import {
  MANUAL_REVIEW_REASONS,
  notSellerEmailPattern,
  type ManualReviewReason,
  type OwnerKind,
  type OwnershipFormInitial,
} from "@/lib/listing-ownership";

export interface OwnershipLabels {
  title: string;
  body: string;
  kindLabel: string;
  kindPlaceholder: string;
  kindIndividuals: string;
  kindEntity: string;
  kindOther: string;
  otherOnTitleQ: string;
  homesteadQ: string;
  homesteadHelp: string;
  spouseQ: string;
  yes: string;
  no: string;
  threeSignersNotice: string;
  signerTitle: string;
  signerTitleHolder: string;
  signerSpouse: string;
  signerNameLabel: string;
  signerEmailLabel: string;
  signerEmailHelp: string;
  signerPermission: string;
  signerNote: string;
  entityNameLabel: string;
  entityTitleLabel: string;
  entityAuthority: string;
  manualReasonLabel: string;
  manualReasons: Record<ManualReviewReason, string>;
  manualNotice: string;
}

type YesNo = OwnershipFormInitial["otherOnTitle"];

const fieldClass =
  "bg-ivory border-2 border-gold-soft px-4 py-3 text-base text-ink focus:outline-none focus:border-gold";
const labelClass = "text-[10px] font-semibold uppercase tracking-[0.22em] text-ink/55";

function YesNoQuestion({
  name,
  question,
  help,
  value,
  onChange,
  labels,
}: {
  name: string;
  question: string;
  help?: string;
  value: YesNo;
  onChange: (v: YesNo) => void;
  labels: { yes: string; no: string };
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm text-ink leading-relaxed">{question}</legend>
      <div className="flex gap-6 pt-1">
        {(["yes", "no"] as const).map((v) => (
          <label key={v} className="flex items-center gap-2 text-sm text-ink">
            <input
              type="radio"
              name={name}
              value={v}
              required
              checked={value === v}
              onChange={() => onChange(v)}
              className="accent-gold"
            />
            {labels[v]}
          </label>
        ))}
      </div>
      {help && <span className="text-xs text-ink/55 leading-relaxed">{help}</span>}
    </fieldset>
  );
}

export function OwnershipSection({
  initial,
  sellerEmail,
  labels: L,
}: {
  initial: OwnershipFormInitial;
  /** Correo de la cuenta del vendedor: el segundo firmante necesita otro. */
  sellerEmail: string | null;
  labels: OwnershipLabels;
}) {
  const [kind, setKind] = useState<OwnerKind | "">(initial.kind);
  const [otherOnTitle, setOtherOnTitle] = useState<YesNo>(initial.otherOnTitle);
  const [homestead, setHomestead] = useState<YesNo>(initial.homestead);
  const [spouse, setSpouse] = useState<YesNo>(initial.coOwnerIsSpouse);

  const both = otherOnTitle === "yes" && homestead === "yes";
  const threeSigners = kind === "individuals" && both && spouse === "no";
  const needsSigner =
    kind === "individuals" && (otherOnTitle === "yes" || homestead === "yes") && !threeSigners && (!both || spouse === "yes");
  const signerRole = otherOnTitle === "yes" ? L.signerTitleHolder : L.signerSpouse;

  return (
    <section className="border border-gold-soft p-5 flex flex-col gap-5" aria-labelledby="ownership-title">
      <div className="flex flex-col gap-1">
        <h3 id="ownership-title" className="font-display text-xl text-ink font-normal">
          {L.title}
        </h3>
        <p className="text-sm text-ink/65 leading-relaxed">{L.body}</p>
      </div>

      <label className="flex flex-col gap-2">
        <span className={labelClass}>{L.kindLabel}</span>
        <select
          name="owner_kind"
          required
          value={kind}
          onChange={(e) => setKind(e.target.value as OwnerKind | "")}
          className={fieldClass}
        >
          <option value="" disabled>
            {L.kindPlaceholder}
          </option>
          <option value="individuals">{L.kindIndividuals}</option>
          <option value="fl_entity">{L.kindEntity}</option>
          <option value="manual_review">{L.kindOther}</option>
        </select>
      </label>

      {kind === "individuals" && (
        <>
          <YesNoQuestion name="other_title_holders" question={L.otherOnTitleQ} value={otherOnTitle} onChange={setOtherOnTitle} labels={L} />
          <YesNoQuestion
            name="married_homestead"
            question={L.homesteadQ}
            help={L.homesteadHelp}
            value={homestead}
            onChange={setHomestead}
            labels={L}
          />
          {both && <YesNoQuestion name="co_owner_is_spouse" question={L.spouseQ} value={spouse} onChange={setSpouse} labels={L} />}
          {threeSigners && (
            <p role="status" className="text-sm text-ink/80 border border-gold-soft bg-ivory-strong/40 p-4 leading-relaxed">
              {L.threeSignersNotice}
            </p>
          )}
        </>
      )}

      {needsSigner && (
        <fieldset className="flex flex-col gap-4 border border-gold-soft p-4">
          <legend className={`${labelClass} px-2`}>
            {L.signerTitle} · {signerRole}
          </legend>
          <label className="flex flex-col gap-2">
            <span className={labelClass}>{L.signerNameLabel}</span>
            <input
              type="text"
              name="signer_full_name"
              required
              minLength={2}
              maxLength={120}
              autoComplete="off"
              defaultValue={initial.signerName}
              className={fieldClass}
            />
          </label>
          <label className="flex flex-col gap-2">
            <span className={labelClass}>{L.signerEmailLabel}</span>
            <input
              type="email"
              name="signer_email"
              required
              maxLength={254}
              autoComplete="off"
              pattern={notSellerEmailPattern(sellerEmail)}
              defaultValue={initial.signerEmail}
              className={fieldClass}
            />
            <span className="text-xs text-ink/55 leading-relaxed">{L.signerEmailHelp}</span>
          </label>
          <label className="flex items-start gap-3 text-sm text-ink leading-relaxed">
            <input
              type="checkbox"
              name="signer_permission"
              value="1"
              required
              defaultChecked={initial.signerPermission}
              className="mt-1 accent-gold"
            />
            <span>{L.signerPermission}</span>
          </label>
          <p className="text-xs text-ink/60 leading-relaxed">{L.signerNote}</p>
        </fieldset>
      )}

      {kind === "fl_entity" && (
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-2">
            <span className={labelClass}>{L.entityNameLabel}</span>
            <input type="text" name="entity_name" required minLength={2} maxLength={200} defaultValue={initial.entityName} className={fieldClass} />
          </label>
          <label className="flex flex-col gap-2">
            <span className={labelClass}>{L.entityTitleLabel}</span>
            <input
              type="text"
              name="entity_signer_title"
              required
              minLength={2}
              maxLength={80}
              defaultValue={initial.entitySignerTitle}
              className={fieldClass}
            />
          </label>
          <label className="flex items-start gap-3 text-sm text-ink leading-relaxed">
            <input type="checkbox" name="entity_authority" value="1" required defaultChecked={initial.entityAuthority} className="mt-1 accent-gold" />
            <span>{L.entityAuthority}</span>
          </label>
        </div>
      )}

      {kind === "manual_review" && (
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-2">
            <span className={labelClass}>{L.manualReasonLabel}</span>
            <select name="manual_review_reason" required defaultValue={initial.manualReason} className={fieldClass}>
              <option value="" disabled>
                {L.kindPlaceholder}
              </option>
              {MANUAL_REVIEW_REASONS.map((r) => (
                <option key={r} value={r}>
                  {L.manualReasons[r]}
                </option>
              ))}
            </select>
          </label>
          <p role="status" className="text-sm text-ink/80 border border-gold-soft bg-ivory-strong/40 p-4 leading-relaxed">
            {L.manualNotice}
          </p>
        </div>
      )}
    </section>
  );
}
