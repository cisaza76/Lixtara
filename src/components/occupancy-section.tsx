"use client";

// Occupancy selector + conditional lease details. Lives inside the step-3
// server-action form: the inputs carry `name`s so the action reads them from
// FormData. Occupancy is required (line 20 of the listing agreement); the empty
// option is only a placeholder. Lease fields appear only when occupancy = tenant_occupied; the
// "difficult tenant" explanation appears only when that option is chosen.
// With a tenant, the lease end date is required as MM/DD/YYYY (the listing agreement's
// format, line 20) unless the seller checks "I don't know" (src/lib/lease-end.ts).

import { useState } from "react";
import { NUMBER_PATTERNS } from "@/lib/form-numbers";

type Occupancy = "" | "vacant" | "owner_occupied" | "tenant_occupied";
type Cooperation = "" | "cooperative" | "advance_notice" | "difficult";

export interface OccupancyLabels {
  occupancyLabel: string;
  occupancyVacant: string;
  occupancyOwner: string;
  occupancyTenant: string;
  leaseInfoTitle: string;
  monthlyRentLabel: string;
  leaseEndLabel: string;
  leaseEndPlaceholder: string;
  leaseEndHelp: string;
  leaseEndUnknown: string;
  tenantCoopLabel: string;
  coopCooperative: string;
  coopAdvanceNotice: string;
  coopDifficult: string;
  tenantNotesLabel: string;
  tenantNotesPlaceholder: string;
  /** Placeholder of the occupancy select; not a valid answer (occupancy is required). */
  occupancyPlaceholder: string;
}

interface Props {
  initialOccupancy: Occupancy;
  initialRent: string;
  initialLeaseEnd: string; // MM/DD/YYYY
  /** Tenant-occupied with no date saved: "I don't know" was chosen. */
  initialLeaseUnknown: boolean;
  initialCooperation: Cooperation;
  initialNotes: string;
  labels: OccupancyLabels;
}

const fieldClass =
  "bg-ivory border-2 border-gold-soft px-4 py-3 text-base text-ink focus:outline-none focus:border-gold";
const labelClass =
  "text-[10px] font-semibold uppercase tracking-[0.22em] text-ink/55";

export function OccupancySection({
  initialOccupancy,
  initialRent,
  initialLeaseEnd,
  initialLeaseUnknown,
  initialCooperation,
  initialNotes,
  labels: L,
}: Props) {
  const [occupancy, setOccupancy] = useState<Occupancy>(initialOccupancy);
  const [cooperation, setCooperation] =
    useState<Cooperation>(initialCooperation);
  const isTenant = occupancy === "tenant_occupied";
  const [leaseUnknown, setLeaseUnknown] = useState(initialLeaseUnknown);

  const coopOptions: { value: Cooperation; label: string }[] = [
    { value: "cooperative", label: L.coopCooperative },
    { value: "advance_notice", label: L.coopAdvanceNotice },
    { value: "difficult", label: L.coopDifficult },
  ];

  return (
    <div className="flex flex-col gap-5">
      <label className="flex flex-col gap-2">
        <span className={labelClass}>{L.occupancyLabel}</span>
        <select
          name="occupancy_status"
          value={occupancy}
          onChange={(e) => setOccupancy(e.target.value as Occupancy)}
          required
          className={fieldClass}
        >
          <option value="" disabled>
            {L.occupancyPlaceholder}
          </option>
          <option value="vacant">{L.occupancyVacant}</option>
          <option value="owner_occupied">{L.occupancyOwner}</option>
          <option value="tenant_occupied">{L.occupancyTenant}</option>
        </select>
      </label>

      {isTenant && (
        <fieldset className="flex flex-col gap-4 border border-gold-soft p-4">
          <legend className={`${labelClass} px-2`}>{L.leaseInfoTitle}</legend>

          <label className="flex flex-col gap-2">
            <span className={labelClass}>{L.monthlyRentLabel}</span>
            <input
              type="text"
              name="monthly_rent"
              pattern={NUMBER_PATTERNS.money}
              inputMode="decimal"
              defaultValue={initialRent}
              className={fieldClass}
            />
          </label>

          <div className="flex flex-col gap-2">
            <label className="flex flex-col gap-2">
              <span className={labelClass}>{L.leaseEndLabel}</span>
              <input
                type="text"
                name="lease_end_date"
                inputMode="numeric"
                autoComplete="off"
                placeholder={L.leaseEndPlaceholder}
                pattern="\d{1,2}/\d{1,2}/\d{4}"
                defaultValue={initialLeaseEnd}
                disabled={leaseUnknown}
                required={!leaseUnknown}
                aria-describedby="lease-end-help"
                className={`${fieldClass} disabled:opacity-50`}
              />
            </label>
            <span id="lease-end-help" className="text-xs text-ink/50">
              {L.leaseEndHelp}
            </span>
            <label className="flex items-center gap-3 text-sm text-ink/80 cursor-pointer">
              <input
                type="checkbox"
                name="lease_end_unknown"
                value="1"
                checked={leaseUnknown}
                onChange={(e) => setLeaseUnknown(e.target.checked)}
                className="accent-gold w-4 h-4 shrink-0"
              />
              <span>{L.leaseEndUnknown}</span>
            </label>
          </div>

          <div className="flex flex-col gap-2">
            <span className={labelClass}>{L.tenantCoopLabel}</span>
            {coopOptions.map((o) => (
              <label
                key={o.value}
                className="flex items-center gap-3 text-sm text-ink/80 cursor-pointer"
              >
                <input
                  type="radio"
                  name="tenant_cooperation"
                  value={o.value}
                  checked={cooperation === o.value}
                  onChange={() => setCooperation(o.value)}
                  className="accent-gold w-4 h-4 shrink-0"
                />
                <span>{o.label}</span>
              </label>
            ))}
          </div>

          {cooperation === "difficult" && (
            <label className="flex flex-col gap-2">
              <span className={labelClass}>{L.tenantNotesLabel}</span>
              <textarea
                name="tenant_notes"
                rows={3}
                defaultValue={initialNotes}
                placeholder={L.tenantNotesPlaceholder}
                className={fieldClass}
              />
            </label>
          )}
        </fieldset>
      )}
    </div>
  );
}
