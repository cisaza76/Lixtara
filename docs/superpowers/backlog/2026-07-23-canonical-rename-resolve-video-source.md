# Backlog — Canonical rename: `defaultResolveVideoSource`

- **Status:** BACKLOG — not scheduled, **not authorized**. Documentation only. No code change here.
- **Opened:** 2026-07-23
- **Origin:** the F4.5 micro-refactor that extracted the current-source authority into
  `src/lib/video-engine/resolve-video-source.ts` (ADR-0009). After extraction the name no longer
  fits its role.

## The problem

`defaultResolveVideoSource(assets: AssetStore)` is a **factory**: it takes an `AssetStore` and
returns the resolver `(listingId, ownerId) => Promise<Asset | null>`. The `default` prefix is a
**historical artifact** from when it was the private "default" of an injectable dependency inside
`worker-deps.ts` (`overrides.resolveVideoSource ?? defaultResolveVideoSource(assets)`).

It is now the **single canonical implementation** (the sole authority per ADR-0009), consumed by
both the render worker and the retention dry-run. `default` implies "one of several / the fallback",
which is misleading — there is no competing implementation to be the default *of*. (The injection
seam at the worker call-site still exists, but the module-level function is THE implementation, not
a default.)

## Alternatives

| Candidate | Reads as | Pros | Cons |
|---|---|---|---|
| `createResolveVideoSource` | "create the resolver" | Matches this repo's factory idiom (`createClient`, `createService`); signals it returns a function; drops the misleading `default`. | Doesn't itself shout "canonical/authority" (that's ADR-0009's job, and the module comment states it). |
| `resolveVideoSourceFactory` | "factory for the resolver" | Unambiguous that it's a factory. | `Factory` suffix appears **nowhere** in this codebase; the established convention is `createX`, so it introduces an inconsistent naming style. |
| *keep `defaultResolveVideoSource`* | — | Zero churn. | Perpetuates the misleading `default`. |

Naming reads best when the factory is `createX` and the returned value is the thing itself:
`const resolveVideoSource = createResolveVideoSource(assets)` — factory vs. instance is obvious.

## Recommendation

**Rename to `createResolveVideoSource`.**

Reasoning:
1. It is a factory; `create` is the repo's established factory prefix (`createClient`,
   `createService`) — consistency over the unused `Factory` suffix.
2. Drops the historically-misleading `default` now that this is the canonical, only implementation.
3. Call-site reads cleanly: `overrides.resolveVideoSource ?? createResolveVideoSource(assets)`,
   and `const resolveVideoSource = createResolveVideoSource(store)` in the dry-run.

## Blast radius (for whenever it is scheduled)

Purely internal, mechanical, behavior-preserving. Known references (2026-07-23):
- `src/lib/video-engine/resolve-video-source.ts` — the `export function` name.
- `src/lib/video-engine/resolve-video-source.test.ts` — import + usage.
- `src/lib/video-engine/worker-deps.ts` — import + the one call-site.
- `scripts/dry-run-source-retention.ts` — import + usage.

No public API, no HTTP contract, no DB, no external consumer. Not a `resolveVideoSource`
(the resolver type/behavior) change — only the **factory's** identifier changes.

## Explicitly out of scope now

Do **not** rename yet. This item requires its own authorization. When taken:
- rename in one mechanical pass, keep the algorithm/signature/behavior identical;
- update the four references above and nothing else;
- gates green (tsc/lint/test/build); behavior parity unchanged.

Do not bundle any other cleanup with it.
