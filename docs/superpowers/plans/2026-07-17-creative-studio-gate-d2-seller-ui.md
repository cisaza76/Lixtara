# Creative Studio v1 — Gate D2 (Seller UI: "Listing video") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add the seller-facing "Listing video" panel (Creative Studio v1) to the seller's listing-management surface (the dashboard, per listing, after the listing card / photos), with one primary action, exactly four visible states, preview-before-download, transparent polling, EN/ES, AA accessibility, and mobile-responsive layout — all behind the existing `CREATIVE_STUDIO_VIDEO_ENABLED` server flag.

**Architecture:** A read-only status API route (`GET /api/creative-studio/video/status`) returns a seller-facing DTO derived from the latest `creative_jobs` row for a listing + (when completed) a signed preview/download URL for its Asset. A pure mapping module collapses the 8 internal job states into 4 seller states. A `"use client"` panel polls that route (visibility-aware, terminal-stop, refresh-safe), renders the four states, and POSTs the existing generate route to create/retry. No new infra, no flag/DSN/bucket activation, no deploy/merge.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript strict, Vitest (node env), Tailwind v4 + shadcn tokens, Supabase (service + RLS clients).

## Global Constraints

- **Feature flag:** server-only `CREATIVE_STUDIO_VIDEO_ENABLED === "true"`. Never introduce a `NEXT_PUBLIC_` variant. The status route fails closed with **404** when off, matching the generate route.
- **Exactly four visible states**, seller-facing labels only: **Ready to create** / **Creating your video** / **Video ready** / **Needs attention**. Never surface internal terms (`queued`, `running`, `rendering`, `qa`, `uploading`, `reconcile`, `queue`, `processing`, `%`).
- **One primary action.** No templates, provider selection, advanced options, cost, multi-generate, auto-publish, or Tour Engine.
- **Preview before download.** Poster/preview must play or open the video; download is a separate, explicit action.
- **Approved copy (verbatim, EN / ES):**
  - Title: `Listing video` / `Video de la propiedad`
  - Subtitle: `Create a polished video using your listing photos.` / `Crea un video pulido con las fotos de tu propiedad.`
  - Ready CTA: `Create listing video` / `Crear video de la propiedad`
  - Ready time hint: `Usually ready in a few minutes.` / `Normalmente estará listo en unos minutos.`
  - Ready disclosure: `Made from your listing photos. The property itself is never digitally altered — and you review the video before using it anywhere.` / `Hecho con las fotos de tu propiedad. La propiedad nunca se altera digitalmente — y revisas el video antes de usarlo.`
  - Creating heading: `Creating your video` / `Creando tu video`
  - Creating note: `You can leave this page — we'll keep going.` / `Puedes salir de esta página — seguiremos trabajando.`
  - Ready-result heading: `Your video is ready` / `Tu video está listo`
  - Meta "made from" chip: `Made from your listing photos` / `Hecho con las fotos de tu propiedad`
  - Meta line format: `Created {date} · {duration} · {resolution}` (e.g. `Created Jul 16, 2026 · 0:17 · 1080p`). Localize the date to the locale; `{duration}` is `m:ss`; `{resolution}` like `1080p`. Omit any segment whose value is unavailable.
  - Download action: `Download video` / `Descargar video`
  - Preview action: `Preview` / `Vista previa`
  - Error heading: `We couldn't finish your video` / `No pudimos terminar tu video`
  - Error reassurance: `Your listing and photos are safe. No video was added.` / `Tu publicación y tus fotos están seguras. No se agregó ningún video.`
  - Error detail: `This sometimes happens — trying again usually works.` / `A veces pasa — volver a intentarlo suele funcionar.`
  - Error action: `Try again` / `Intentar de nuevo`
  - Contact support (secondary, error only): `Contact support` / `Contactar soporte`
- **Skeleton-first, no misleading flash.** On mount, before the first status resolves, render a stable-dimension skeleton — NOT the "Ready to create" CTA. Do not enable the primary action until the real state is known (prevents premature duplicate generation).
- **Polling:** stop on `completed`/`failed`/`cancelled`; pause (or stop) when the tab is hidden (`visibilitychange`) and resume/refetch on return; never create jobs (status is GET-only); state survives a full page refresh (initial fetch re-resolves it).
- **Accessibility AA:** visible keyboard focus; `aria-live="polite"` region announcing state changes; `prefers-reduced-motion` disables the spinner animation; buttons are real `<button>`/`<a>`; poster play control is keyboard-operable.
- **i18n parity:** EN and ES key sets identical (a deep-recursive parity test already exists — keep it green).
- **Quality gates:** `pnpm tsc --noEmit`, `pnpm lint`, `pnpm test`, `pnpm migrations:check`, `pnpm build` all pass. No migration applied, no bucket, no flag/DSN set, no push/merge/deploy.
- **Mount location:** `src/app/[lang]/dashboard/page.tsx`, inside the per-listing `flex flex-col gap-4` wrapper, AFTER `MediaStrategyPanel`. NEVER the 8-step onboarding / Step 5.

---

## File Structure

- Create `src/lib/creative-studio/seller-video-status.ts` — pure state mapping + DTO types + meta derivation.
- Create `src/lib/creative-studio/seller-video-status.test.ts` — unit tests.
- Modify `src/lib/creative-jobs/jobs.ts` — add `findLatestByListing` to `JobsStore` port.
- Modify `src/lib/creative-jobs/jobs-store.supabase.ts` — implement `findLatestByListing`.
- Create `src/app/api/creative-studio/video/status/route.ts` — `GET` status handler (`handleVideoStatus` testable core + `GET` flag gate).
- Create `src/app/api/creative-studio/video/status/route.test.ts` — handler unit tests with fakes.
- Modify `src/lib/i18n.ts` — add `creativeStudio.listingVideo` block to `en` and `es`.
- Create `src/components/listing-video-panel.tsx` — the `"use client"` panel.
- Modify `src/app/[lang]/dashboard/page.tsx` — server flag + mount.

---

### Task D2-1: Pure seller-state mapping + DTO

**Files:**
- Create: `src/lib/creative-studio/seller-video-status.ts`
- Test: `src/lib/creative-studio/seller-video-status.test.ts`

**Interfaces:**
- Consumes: `CreativeJobState` from `@/lib/creative-jobs/states`; `Asset` from `@/lib/assets/types`.
- Produces:
  - `type SellerVideoState = "idle" | "creating" | "completed" | "failed";`
  - `interface SellerVideoMeta { createdAt: string; durationSeconds: number | null; resolutionLabel: string | null; photoCount: number | null; }`
  - `interface SellerVideoStatusDto { state: SellerVideoState; video: { previewUrl: string; downloadUrl: string; meta: SellerVideoMeta } | null; }`
  - `function mapJobStateToSeller(state: CreativeJobState | null): SellerVideoState`
  - `function deriveVideoMeta(asset: Pick<Asset, "createdAt" | "qa" | "provenance">): SellerVideoMeta`

**Mapping rules:** `null → "idle"`; `completed → "completed"`; `failed → "failed"`; `cancelled → "idle"`; any of `queued|running|rendering|qa|uploading → "creating"`. `deriveVideoMeta` reads `asset.qa` defensively (it may be `unknown`): if it looks like a `TechnicalQaResult` (`typeof durationSec === "number"` → `durationSeconds`; `typeof height === "number"` → `resolutionLabel = \`${height}p\``), else nulls; `photoCount` from `asset.provenance.sourceAssetIds.length` when it's an array, else null; `createdAt` passthrough.

- [ ] **Step 1: Write failing tests** covering: all 8 states + null map correctly; `deriveVideoMeta` extracts `{durationSeconds, resolutionLabel, photoCount}` from a valid qa+provenance; returns nulls for `qa: null`, `qa: {}` (missing fields), `qa: "garbage"`, and `provenance` without a `sourceAssetIds` array; `createdAt` passes through.
- [ ] **Step 2: Run** `pnpm test seller-video-status` → FAIL (module missing).
- [ ] **Step 3: Implement** the pure module per the rules above (no I/O, no Supabase import).
- [ ] **Step 4: Run** `pnpm test seller-video-status` → PASS.
- [ ] **Step 5: Commit** `feat(creative-studio): pure seller-facing video status mapping + meta`.

---

### Task D2-2: Listing-scoped latest-job read

**Files:**
- Modify: `src/lib/creative-jobs/jobs.ts` (add to `JobsStore` interface)
- Modify: `src/lib/creative-jobs/jobs-store.supabase.ts` (implement)

**Interfaces:**
- Produces: `findLatestByListing(listingId: string): Promise<CreativeJob | null>` on `JobsStore`.

**Implementation:** In `jobs-store.supabase.ts`, query `creative_jobs` `.eq("listing_id", listingId).order("created_at", { ascending: false }).limit(1).maybeSingle()`, map the row through the SAME row→`CreativeJob` mapper the file already uses for `getJob` (do not hand-roll a second mapper — reuse the private mapping function). Add the method to the `JobsStore` interface in `jobs.ts` with a doc comment ("latest job for a listing, newest by created_at, or null").

- [ ] **Step 1:** Add `findLatestByListing` to the `JobsStore` interface in `jobs.ts` with its doc comment.
- [ ] **Step 2:** Implement it in `SupabaseJobsStore`, reusing the existing row-mapper.
- [ ] **Step 3: Run** `pnpm tsc --noEmit` → PASS (interface + impl aligned; any in-repo `JobsStore` fakes updated to satisfy the new member — search test files for `implements JobsStore` / object literals typed as `JobsStore` and add the method).
- [ ] **Step 4: Commit** `feat(creative-jobs): findLatestByListing read for seller status`.

---

### Task D2-3: Status API route

**Files:**
- Create: `src/app/api/creative-studio/video/status/route.ts`
- Test: `src/app/api/creative-studio/video/status/route.test.ts`

**Interfaces:**
- Consumes: `mapJobStateToSeller`, `deriveVideoMeta`, DTO types (D2-1); `findLatestByListing` (D2-2); `SupabaseAssetStore.getById`; `createSignedUrl`.
- Mirrors the generate route's dependency-injection shape so it is unit-testable with fakes.

**Contract (`GET /api/creative-studio/video/status?property_id=<uuid>`):**
1. Flag gate FIRST → **404** `{ error: "not_found" }` when `CREATIVE_STUDIO_VIDEO_ENABLED !== "true"`.
2. Auth (`deps.getUser()`) → **401** `{ error: "not_authenticated" }`.
3. `property_id` query param required → **400** `{ error: "property_id_required" }`.
4. Ownership via RLS-scoped read (`deps.loadProperty`), explicit `owner_id !== user.id` → **403** `{ error: "property_not_found_or_not_yours" }`.
5. `job = deps.findLatestByListing(propertyId)`; `state = mapJobStateToSeller(job?.state ?? null)`.
6. If `state === "completed"` and `job.assetId`: `asset = deps.getAsset(job.assetId)`. If asset present, `deps.signUrls(asset)` → `{ previewUrl, downloadUrl }` (download signed with a content-disposition filename like `listing-video.mp4`); `video = { previewUrl, downloadUrl, meta: deriveVideoMeta(asset) }`. If the asset or signing is unavailable, degrade to `state:"creating"` with `video:null` (never 500 the seller for a transient signing gap) — a completed job whose asset can't yet be signed reads as still finishing, not broken.
7. Else `video = null`.
8. **200** `{ state, video }` (the `SellerVideoStatusDto`). Never leak storage paths, buckets, error codes, or internal state strings.

Use `createClient()` (RLS, cookie) for auth+ownership and `createService()` for the jobs/asset store + signing (private bucket), exactly like the generate route.

- [ ] **Step 1: Write failing tests** (call `handleVideoStatus(req, fakeDeps)` directly): 401 (no user); 400 (no param); 403 (not owner); `idle` (no job); `creating` (job `rendering`); `failed` (job `failed`); `completed` with signed `previewUrl`/`downloadUrl` + meta; completed-but-asset-missing degrades to `creating`/`video:null`; assert the response body NEVER contains `storagePath`/`storageBucket`/`errorCode`/raw internal state.
- [ ] **Step 2: Run** `pnpm test video/status` → FAIL.
- [ ] **Step 3: Implement** `handleVideoStatus(req, deps)` + `defaultDeps()` + `GET` (flag gate → `handleVideoStatus(req, defaultDeps())`).
- [ ] **Step 4: Run** `pnpm test video/status` → PASS.
- [ ] **Step 5: Commit** `feat(creative-studio): seller video status route`.

---

### Task D2-4: i18n `creativeStudio.listingVideo` (EN + ES)

**Files:**
- Modify: `src/lib/i18n.ts` (add a `creativeStudio: { listingVideo: {...} }` block to BOTH `en` (near the `mediaAgent` block, ~line 1158) and `es` (its mirror), identical key sets).

**Keys** (all from Global Constraints' approved copy) — flat where possible:
`title, subtitle, createCta, timeHint, disclosure, creatingHeading, creatingNote, readyHeading, madeFromChip, download, preview, errorHeading, errorReassurance, errorDetail, tryAgain, contactSupport`, plus a nested `meta: { createdPrefix, resolutionSuffix }` if needed for date/label composition (keep the `Created {date} · {duration} · {resolution}` join in the component; only put translatable words here). Also a `srCreating`/`srReady`/`srFailed` set of screen-reader status announcements: EN `Creating your video`, `Your video is ready`, `We couldn't finish your video`; ES mirrors.

- [ ] **Step 1:** Add the EN block with the verbatim approved English copy.
- [ ] **Step 2:** Add the ES block with the verbatim approved Spanish copy, identical key set.
- [ ] **Step 3: Run** `pnpm test i18n` → PASS (parity test stays green).
- [ ] **Step 4: Commit** `feat(i18n): creativeStudio.listingVideo strings (en/es)`.

---

### Task D2-5: ListingVideoPanel client component

**Files:**
- Create: `src/components/listing-video-panel.tsx`

**Interfaces:**
- Consumes: DTO types (D2-1); the `creativeStudio.listingVideo` copy object shape (D2-4); `GET /api/creative-studio/video/status`, `POST /api/creative-studio/video/generate`.
- Produces (mounted by D2-6):
  ```ts
  export function ListingVideoPanel(props: {
    propertyId: string;
    lang: Locale;
    copy: Copy;              // local interface mirroring t(lang).creativeStudio.listingVideo
  }): JSX.Element
  ```
  (Server gates the mount on the flag, so the component itself is always "enabled" when rendered; no `enabled` prop needed — but accept nothing beyond the three above.)

**Behavior (implements the Global Constraints polling + skeleton + state rules):**
- `"use client"`. State: `status: SellerVideoStatusDto | null` (null = resolving), `busy` (a POST is in flight), `previewOpen`.
- On mount: fetch status once; then `setInterval` (e.g. 3000 ms) re-fetch. A `document.hidden` check at the top of each tick skips the fetch; a `visibilitychange` listener triggers an immediate refetch on return. Clear interval + listener on unmount. Stop polling once `status.state` is `completed` or `failed` (idle keeps a slow poll only while a POST could be settling — simplest correct: after a successful POST, resume polling; when idle with no POST, poll is unnecessary — poll while state is `creating` or immediately after a create). Keep it simple: always poll on an interval but guard with `document.hidden` and short-circuit the network call when `state` is terminal.
- Skeleton: while `status === null`, render a fixed-height skeleton block (same outer dimensions as the resolved card) with NO primary button.
- `idle`: title/subtitle/disclosure + primary `createCta` button + `timeHint`. Click → `busy=true`, `POST generate {property_id}`, on 202 immediately refetch status (→ `creating`); on 422/403/etc. surface the error state's copy (generic — do not print server codes).
- `creating`: `creatingHeading` + calm spinner (respect `prefers-reduced-motion`) + `creatingNote`. No primary action.
- `completed`: poster (gold eyebrow + address-less brand poster is fine; use a simple branded poster or the first frame is out of scope — render a play affordance over a brand-colored block) → clicking play opens an inline `<video controls autoPlay src={previewUrl}>` (or toggles it); meta line `Created {localeDate} · {m:ss} · {res}` (omit missing segments) + `madeFromChip`; primary `download` (an `<a href={downloadUrl} download>`), secondary `preview`.
- `failed`: amber attention block with `errorHeading` + `errorReassurance` + `errorDetail`; primary `tryAgain` (same as create) + secondary `contactSupport` (a mailto or existing support link if one exists; otherwise render as a link to `/[lang]/contact` if present, else omit — do not invent an endpoint).
- Accessibility: an `aria-live="polite"` visually-adjacent region announcing `srCreating`/`srReady`/`srFailed` on transition; visible focus rings (use existing Tailwind focus classes seen in sibling components); spinner `motion-reduce:animate-none`.
- Styling: match `MediaStrategyPanel`/`SellerListingCard` Tailwind idiom (ivory/ink/gold tokens, rounded card, `text-ink/…` opacities). Responsive: stacks and stays within the card at mobile widths; the video is `max-w-full`.

- [ ] **Step 1:** Implement the component with a local `Copy` interface, the four states, skeleton-first, and the polling/visibility logic above.
- [ ] **Step 2: Run** `pnpm tsc --noEmit` and `pnpm lint` → PASS.
- [ ] **Step 3: Commit** `feat(creative-studio): seller Listing video panel`.

---

### Task D2-6: Mount in dashboard

**Files:**
- Modify: `src/app/[lang]/dashboard/page.tsx`

**Implementation:**
- Add `const listingVideoEnabled = process.env.CREATIVE_STUDIO_VIDEO_ENABLED === "true";` beside the existing `mediaAgentEnabled` (line ~141).
- Import `ListingVideoPanel`.
- Inside the per-listing wrapper (the `flex flex-col gap-4` block, ~lines 562–597), AFTER the `{mediaAgentEnabled && <MediaStrategyPanel .../>}` block, add:
  ```tsx
  {listingVideoEnabled && (
    <ListingVideoPanel
      propertyId={l.id}
      lang={lang as Locale}
      copy={t(lang).creativeStudio.listingVideo}
    />
  )}
  ```

- [ ] **Step 1:** Add the flag, import, and gated mount.
- [ ] **Step 2: Run** `pnpm tsc --noEmit`, `pnpm lint`, `pnpm build` → PASS.
- [ ] **Step 3: Commit** `feat(dashboard): mount Listing video panel behind flag`.

---

### Task D2-7: Visual validation (controller, not a subagent)

Run the app locally with `CREATIVE_STUDIO_VIDEO_ENABLED=true`, sign in as a seller with a listing, and verify the four states + skeleton on desktop and mobile widths, in EN and ES: no internal terms leak, focus/aria/reduced-motion behave, preview plays before download, refresh preserves state, and no duplicate job is created on rapid clicks. Capture screenshots. Then STOP for owner review before any deploy/flag activation.

## Self-Review notes
- Every task ends independently testable/committable. D2-1..D2-4 are pure/back-end (unit-tested); D2-5/D2-6 are UI (type/lint/build-gated + controller visual validation in D2-7).
- Types are threaded: D2-1 exports the DTO consumed by D2-3 and D2-5; D2-2's `findLatestByListing` is consumed by D2-3; D2-4's copy shape is consumed by D2-5's `Copy` interface and D2-6's `t(lang)` access.
- No new external infra; flag stays off; production untouched.
