# ADR-0010 — Uploaded Video Access Control (Gate 5 pre-rollout)

- **Status:** Accepted — 2026-07-27
- **Scope:** Gate 5 — who may see and use the Creative Studio uploaded-video feature, with an
  optional per-listing scope and a per-grant generation quota. Covers all seven server surfaces
  (dashboard panel + the source read / initiate / complete / preview / status / generate routes).
- **Related:** ADR-0006 (job routing), ADR-0007 (source replacement), ADR-0008 (temporary media
  access), ADR-0009 (asset retention). Frozen segmentation spec v2 is the architectural authority
  behind this ADR.
- **Migration:** `supabase/migrations/20260727180000_creative_studio_video_access.sql`
  (**authored, NOT applied**). Rollback:
  `docs/superpowers/runbooks/rollback-20260727180000_creative_studio_video_access.sql`.

## Context

Before this change the feature was gated by a single global flag,
`CREATIVE_STUDIO_VIDEO_ENABLED`. With the flag on, EVERY authenticated seller who owned a listing
could see and drive the pipeline — a coarse, all-or-nothing exposure. Gate 5 needs a controlled
rollout: only specific sellers (and optionally only specific listings) should have the feature,
each with a bounded number of generations, and the rollout must stay halted by default.

## Decision

A server-side **allowlist** table, `creative_studio_video_access`, plus a single decision
authority consulted by every surface. Key properties:

1. **Fail-closed by construction.** An empty table means NOBODY has access, even with the global
   flag on. A missing / disabled / revoked / out-of-window grant, an exhausted quota, a listing
   out of scope, OR a reader error all deny. This is a net security improvement: the flag alone
   currently exposes the feature to every owner; shipping the (empty) table closes that.

2. **Global flag stays the kill switch.** `CREATIVE_STUDIO_VIDEO_ENABLED` is checked FIRST on
   every route (fail-closed 404 when unset) and gates the dashboard panel. The allowlist is an
   AND on top of it — turning the flag off still stops everyone instantly.

3. **Service-role only; RLS deny-all.** The table has RLS enabled with NO policies, so no
   anon/authenticated (browser) client can read or write it — a seller can never self-authorize
   and the row can never leak to the client. The only reader/writer is the service-role authority
   (`src/lib/creative-studio/video-access.ts` + `video-access.supabase.ts`).

4. **The UI only reflects the decision.** `userId` comes from the authenticated session and
   `listingId` must have passed the route's ownership check before the authority runs; the
   authority trusts neither from the request body. A hidden dashboard panel is UX, not the
   security boundary — every route re-checks server-side.

5. **Validation order (every surface):** flag → auth → ownership → **access** → route logic.

6. **HTTP mapping (shared, so all surfaces answer identically):**
   - Generate surface (`videoAccessDenial`): `quota_exhausted` → **403 `quota_exhausted`**
     (feature is visible to this seller, just out of generations); `consent_required` → **403
     `consent_required`** (structural, only reachable once a grant sets `consentRequired`);
     everything else, incl. `reader_error` → **404 `not_found`** (feature invisible).
   - Read / upload surfaces (`videoVisibilityDenial`): allowlisted + in-scope is **visible even
     when out of quota** — quota gates ONLY the generate action; a seller who spent their
     generations can still upload/replace/preview/read. Non-allowlisted / out-of-scope → **404**.

7. **Quota is a safety rail, not a billing meter.**
   - The ceiling (`generations_used < max_generations`) is enforced ONLY in the consume UPDATE,
     never as a table CHECK — an admin can lower `max_generations` below `generations_used`
     freely.
   - Consume is ONE guarded conditional UPDATE, a compare-and-swap on `generations_used`. The CAS
     bounds the ceiling without a column-to-column filter (unsupported by supabase-js): a consumer
     only reaches it after the authority read `used < max`, so the write lands at `used+1 ≤ max`,
     and two racers for the last slot can only have one CAS match.
   - **Exactly-once consumption:** `createJob` returns `{ job, created }`; the generate route
     consumes ONLY when `created === true` (an actual insert). Retries and concurrent duplicates
     of the same logical job return `created === false` and never double-consume.
   - **Benign residual (safe direction):** if the consume CAS misses AFTER the job was created
     (the rare distinct-generation boundary race), the already-created job still proceeds — we
     record it and do not fail the seller. At most ≤1 extra render, never an over-count that would
     wrongly block a legitimate seller.

8. **Audit + consent.** `activity_log` (no new audit table) records append-only telemetry
   (`video_generation_requested` / `video_access_blocked` / `video_quota_consumed`) with
   PII-free, enum-like metadata. Internal consent (`video_consent_recorded`, find-or-insert,
   idempotent) is **structurally prepared** for the 5B seller-facing path — the authority reports
   `consentRequired = false` in 5A, so the consent gate is dormant. **No consent is recorded to
   production in this PR** (Gate 5A execution is out of scope).

## Grant schema (authored)

`creative_studio_video_access`: `user_id` (FK auth.users), `listing_id` (FK properties, **null =
all the user's listings**), `enabled`, `max_generations` / `generations_used` (both `>= 0`, no
ceiling CHECK), `valid_from` / `valid_until` (optional window), `approved_by`, `reason`,
`revoked_at`, timestamps. Two partial unique indexes enforce ONE active grant per scope
(per-listing and all-listings) without a sentinel UUID; a per-user partial index covers the read
path. A listing-specific grant is preferred over a blanket one so a per-listing quota is honored
ahead of a wider one.

## Operations

- **Grant / revoke** is a service-role admin action (a script, out of this PR): insert a row, or
  set `revoked_at` to revoke while preserving the row as evidence. Lowering `max_generations`
  tightens quota without fighting a constraint.
- **Halt options, least to most drastic:** set `revoked_at` on individual grants → unset
  `CREATIVE_STUDIO_VIDEO_ENABLED` for a global stop → (last resort) run the rollback SQL, which is
  safe only while the table is empty (it drops the authorization state).
- **Rollout stays halted:** the migration is authored-not-applied and the table ships empty, so
  applying it changes nothing observable until the first grant is issued under separate sign-off.

## Consequences

- One code authority, one HTTP mapping, one migration — every surface behaves consistently and a
  new surface only has to call `checkAccess` + the right denial mapper.
- The pure decision logic is unit-tested without Supabase (DI reader); the service-role adapter,
  guard mapping, audit, and each route's gating are covered (test count 821 → 893).
- Residual accepted: quota may under-count by ≤1 in a rare boundary race (safe direction). Precise
  billing is explicitly NOT a goal here.
