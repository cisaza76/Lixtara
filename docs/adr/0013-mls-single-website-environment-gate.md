# ADR-0013 — Single-website environment gate for MLS Licensed Content

- **Status:** accepted (2026-09-10) — authored ahead of the feed, so the feed cannot be
  wired without it.
- **Context:** MIAMI AOR Broker 2024 Member Data License Agreement (No Third Party Vendor),
  agreement `c02e588c-9ea1-4730-9a7c-7b537d49b270`, awaiting the Designated Broker's
  signature. Written clarifications from MIAMI staff (Benjamin Costa, 2026-09-09).
- **Related:** ADR-0010 (uploaded-video access control — same fail-closed posture),
  `docs/legal/2026-09-03-miami-mls-data-license-analisis.md`

## Context

The agreement licenses the Data Feed for **one** website:

> Schedule B §1 — *"This is the ONLY Website authorized to receive the Data Feed."*
> §IX.J — *"...place the Licensed Content on **one (1) single Website**, specifically named
> in this Agreement. Additional website(s) and subdomains thereof shall incur additional
> Fees."*

Lixtara deploys on Vercel. That produces hosts the agreement does not name:

- a preview URL for **every pull request** (`lixtara-<hash>-….vercel.app`)
- a branch alias (`lixtara-git-<branch>-….vercel.app`)
- the production alias `lixtara.vercel.app`, which serves the **same deployment** as
  `lixtara.com`

MIAMI confirmed in writing that non-public environments *"do not have to be declared"* and
that restricting the feed to production is *"Yes"*, the correct approach. That answer makes
the environment boundary the control — so the boundary has to actually exist in code, not in
a developer's memory. The penalty for getting it wrong is not theoretical: §VI.B.7 lets
MIAMI terminate **at its sole discretion** upon its own determination that a Rule was
violated, effective within one business day.

## Decision

A pure, fail-closed gate module, `src/lib/mls/environment-gate.ts`, authored **before** any
feed code exists. Two gates, because the contract separates where the feed *lands* from
where content is *displayed*:

| Path | Gate | Why |
|---|---|---|
| **Ingest** — cron → Bridge API → database | `VERCEL_ENV === "production"` **and** `MLS_FEED_ENABLED === "true"` | A Vercel Cron invocation does not arrive through `lixtara.com`, so a host check would break the only legitimate ingest path. |
| **Display** — serving Licensed Content in a response | the ingest checks **plus** the request host ∈ `{lixtara.com, www.lixtara.com}` | A production deployment also answers on `lixtara.vercel.app`. Environment alone does not prove the request reached the licensed Website. |

Display is strictly stronger than ingest; that relation is asserted in tests.

Supporting choices:

- **Only the literal `"true"` opens the flag.** `"1"`, `"TRUE"` and an unset variable all
  deny — the same convention as `CREATIVE_STUDIO_VIDEO_ENABLED`, and it doubles as a kill
  switch if MIAMI suspends the feed.
- **The Bridge credential is behind the gate.** `requireMlsServerToken()` asserts ingest
  before returning `MLS_BRIDGE_SERVER_TOKEN`, so a preview cannot call Bridge even if the
  variable were set there by mistake. The variable is never `NEXT_PUBLIC_`-prefixed.
- **Host normalization is explicit** — lowercase, port stripped, trailing dot stripped, and
  the first entry of a chained `x-forwarded-host`. Suffix attacks such as
  `lixtara.com.evil.test` are rejected by exact membership, not by `endsWith`.
- **Typed denial reasons** (`feed_disabled`, `not_production`, `host_missing`,
  `host_not_licensed`) so a refusal is diagnosable without parsing a message.
- **The module is pure**, with an injectable env, so every branch is testable without
  touching `process.env`.

## Consequences

- MLS Licensed Content can exist only in a production deployment served from the licensed
  domain. Preview deployments — the environment where all development happens — will never
  hold it. Any feature that renders MLS data must be exercised in production or against
  fixtures.
- The feed cannot be switched on by deploying code. It also requires setting
  `MLS_FEED_ENABLED=true` in Production only, which is a separate, auditable act.
- `MLS_FEED_ENABLED` and `MLS_BRIDGE_SERVER_TOKEN` must be set in **Production only** —
  never Preview, never Development. Setting them elsewhere is inert by design, but it should
  still be treated as a misconfiguration.
- Adding a second licensed website later means amending the agreement first (and paying the
  additional fee), then extending `MLS_LICENSED_HOSTS`. The constant is the single place to
  change, and its contents are pinned by a test.

## Alternatives rejected

- **Environment check only.** Simpler, but leaves `lixtara.vercel.app` serving Licensed
  Content from a production deployment — a host the agreement does not name.
- **Host check only.** Would allow a preview deployment to serve Licensed Content if a Host
  header were spoofed, and gives no kill switch.
- **Declaring the Vercel domains as subdomains in Schedule B.** MIAMI said it is not
  required, preview hostnames are ephemeral and unbounded (one per PR, so they could never
  be kept current), and Schedule B §2 warns that additional websites *"shall incur
  additional Fees."*
- **Relying on the reviewer.** The failure is silent, the detection is external, and the
  remedy is termination at the counterparty's sole discretion.
