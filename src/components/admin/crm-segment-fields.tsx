import {
  HAS_EMAIL,
  OUTREACH_STATUSES,
  OWNER_TYPES,
  PILOT_GROUPS,
  PRIORITIES,
  type Segment,
} from "@/lib/crm/segment";
import type { t } from "@/lib/i18n";

type Crm = ReturnType<typeof t>["crm"];

const selectCls =
  "border border-gold-soft bg-white px-2.5 py-1.5 text-sm text-ink focus:outline-none focus:border-gold";
const labelCls = "flex flex-col gap-1 text-[10px] uppercase tracking-[0.18em] text-ink/55";

/** The segment's form fields. Field names match parseSegment(). No signal / MLS filter on purpose. */
export function CrmSegmentFields({ c, value }: { c: Crm; value: Segment }) {
  const opt = (list: readonly string[], map?: Record<string, string>) =>
    list.map((v) => (
      <option key={v} value={v}>
        {map?.[v] ?? v}
      </option>
    ));
  return (
    <>
      <label className={labelCls}>
        {c.filters.priority}
        <select name="priority" defaultValue={value.priority ?? ""} className={selectCls}>
          <option value="">{c.any}</option>
          {opt(PRIORITIES)}
        </select>
      </label>
      <label className={labelCls}>
        {c.filters.ownerType}
        <select name="ownerType" defaultValue={value.ownerType ?? ""} className={selectCls}>
          <option value="">{c.any}</option>
          {opt(OWNER_TYPES, c.ownerTypes)}
        </select>
      </label>
      <label className={labelCls}>
        {c.filters.zip}
        <input
          name="zip"
          defaultValue={value.zip ?? ""}
          inputMode="numeric"
          pattern="\d{5}"
          maxLength={5}
          placeholder="33133"
          className={`${selectCls} w-24`}
        />
      </label>
      <label className={labelCls}>
        {c.filters.pilotGroup}
        <select name="pilotGroup" defaultValue={value.pilotGroup ?? ""} className={selectCls}>
          <option value="">{c.any}</option>
          {opt(PILOT_GROUPS)}
        </select>
      </label>
      <label className={labelCls}>
        {c.filters.status}
        <select name="status" defaultValue={value.status ?? ""} className={selectCls}>
          <option value="">{c.any}</option>
          {opt(OUTREACH_STATUSES, c.statuses)}
        </select>
      </label>
      <label className={labelCls}>
        {c.filters.hasEmail}
        <select name="hasEmail" defaultValue={value.hasEmail ?? ""} className={selectCls}>
          <option value="">{c.any}</option>
          {opt(HAS_EMAIL, { yes: c.yes, no: c.no })}
        </select>
      </label>
    </>
  );
}

export function describeSegment(c: Crm, seg: Segment): string {
  const parts: string[] = [];
  if (seg.priority) parts.push(`${c.filters.priority}: ${seg.priority}`);
  if (seg.ownerType) parts.push(`${c.filters.ownerType}: ${c.ownerTypes[seg.ownerType] ?? seg.ownerType}`);
  if (seg.zip) parts.push(`${c.filters.zip}: ${seg.zip}`);
  if (seg.pilotGroup) parts.push(`${c.filters.pilotGroup}: ${seg.pilotGroup}`);
  if (seg.status) parts.push(`${c.filters.status}: ${c.statuses[seg.status] ?? seg.status}`);
  if (seg.hasEmail) parts.push(`${c.filters.hasEmail}: ${seg.hasEmail === "yes" ? c.yes : c.no}`);
  return parts.length ? parts.join(" · ") : c.campaign.segmentAll;
}
