# ADR-0008 — Temporary Media Access

- **Status:** Accepted — 2026-07-23
- **Scope:** F4.4 (Source Video Preview) — how the client is granted playback access to an
  owner's Source Video, and the contract that models it.
- **Related:** F4.1 (source upload / two-phase signed URLs); F4.3 (management UI); ADR-0007
  (replacement policy); F3-A Contract Freeze.

## Context

The F4.4 preview lets a listing **owner** play their current Source Video from the dashboard.
The video lives in a private Supabase Storage bucket (`creative-studio`, `source/…` prefix)
gated by RLS; it has no public URL and must never get one. The browser `<video>` element,
however, needs *some* fetchable handle to render the media.

The naive shape — return a "preview URL" — couples the public contract to one concrete access
mechanism (a signed URL), invites the client to treat it as stable, and risks it being cached,
persisted, or logged. This ADR records the access model that avoids all of that.

## Decision

1. **Temporary access only.** The server grants a **short-lived** handle to play the media, never
   standing access. TTL is **5 minutes** (`SOURCE_PREVIEW_TTL_SECONDS = 300`). After `expiresAt`
   the grant is invalid and must be renewed.
2. **Server-side generation.** The signed URL is minted **exclusively on the server** (the
   endpoint's `createTemporaryAccess`, using the service client). The server builds the storage
   path from the owner's Asset — **the client never supplies a bucket, path, or token**, and the
   DTO never carries them. Access is issued only after owner-ownership is verified.
3. **Never a public URL.** The bucket is private; access is always a scoped, expiring grant. No
   code path produces, stores, or returns a public/permanent URL for source media.
4. **Never persist the grant.** The grant is not written to the DB, not logged, and not cached.
   The endpoint responds with `Cache-Control: private, no-store, max-age=0` on **every** response
   so no browser or shared/proxy cache retains it. The client holds it only in transient React
   state for the life of the `<video>` element.
5. **Short TTL.** Five minutes is long enough to start and watch a preview, short enough that a
   leaked handle is near-worthless. TTL is a single server-side constant, not client-influenced.
6. **Reactive renewal (no timers).** The client renews **only** when it is about to use the
   access — on a play request when `isAccessExpired` is true, or once when playback fails
   (`<video onError>`, how an expired signed URL surfaces as a 403). There are **no client-side
   timers/polling** keeping a grant warm; an idle preview holds no live credential.
7. **Interchangeable mechanism.** The contract models a *temporary media access*, not a signed
   URL. Today it is backed by `storage.createSignedUrl`; it could become a proxied stream, a
   tokenized route, or a CDN-signed cookie with **no change to the DTO or the client**. The
   endpoint's `createTemporaryAccess` dependency is the single seam where the mechanism lives.
8. **Client decoupled from the mechanism.** The public type is
   `TemporaryMediaAccess { locator: string; expiresAt: string }`. The field is named `locator`
   (not `url`) precisely so the contract does not reveal or imply the concrete mechanism. The
   client MUST treat `locator` as an **opaque, expiring handle**: never a stable/public URL,
   never persisted, never assumed valid past `expiresAt`, never parsed for meaning.

## Consequences

- The preview works over a private bucket with no public exposure and no persisted credentials.
- A leaked grant is bounded to a 5-minute, owner-scoped, non-cacheable window.
- The access mechanism can evolve server-side without a client or contract change — the rename
  to `locator` and the `createTemporaryAccess` seam are what buy that freedom.
- Cost: a valid grant requires a round-trip on (re)play rather than being kept alive client-side;
  this is intentional (reactive renewal, no standing credential).
- `durationSeconds` stays server-side `null` (deriving it would require preparation/ffprobe,
  out of F4.4 scope); the client may read duration from the `<video>` element if needed.
