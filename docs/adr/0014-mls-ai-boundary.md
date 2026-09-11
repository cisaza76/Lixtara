# ADR-0014 — Hard boundary between MLS Licensed Content and AI

- **Status:** accepted (2026-09-10) — authored ahead of the feed.
- **Context:** MIAMI AOR Data License Agreement § III.B.4. Finding #1 of
  `docs/legal/2026-09-03-miami-mls-data-license-analisis.md`.
- **Related:** ADR-0013 (single-website environment gate)

## Context

§ III.B.4 prohibits, without qualification:

> *"Feed license Licensed Content, **directly or indirectly**, to any generative artificial
> intelligence model ("AI"), including but not limited to image recognition technology, ...
> language translation programs, ... logical AI programs, **and/or chatbots**, for any
> purpose, including but not limited to **machine processing**, machine learning, machine
> perception, machine control, training, harvesting..."*

This is not a "do not train models on it" clause. It says *machine processing* and it names
*chatbots*. Lixtara runs four AI surfaces that would each breach it on contact with MLS data:

| Surface | Why it breaches |
|---|---|
| **Loui** (`api/loui`, `loui-prompt.ts`, Anthropic) | Literally a chatbot |
| **Media Intelligence Agent** (Claude Vision) | Machine perception over images |
| **AI staging** (`luma.ts`, Luma Uni-1) | Image model |
| **Tour processing** (`gemini-video.ts`) | Generative model |

The documented F3 plan made this concrete: *"use the MLS feed for the price recommendation
model → blend MLS + Anthropic."* That plan is struck.

Two distinct leak paths exist, and they need different controls:

1. **Module coupling** — an AI module imports the MLS module, directly or through a chain.
   The word *indirectly* in the clause maps precisely to the transitive import closure.
2. **Data flow** — a route or page reads MLS rows and passes them into a prompt. Neither
   module imports the other, so no import rule can see it.

## Decision

**Two controls, one per leak path.**

### 1. Static import-graph guard — `src/lib/mls/ai-boundary.test.ts`

Builds the import graph of `src/` (static, `export … from`, and dynamic `import()`;
resolving `@/` and relative specifiers) and asserts:

- no AI surface reaches `src/lib/mls/**` by **any** path, transitively;
- `src/lib/mls/**` imports no AI SDK and no AI surface (the reverse leak);
- the AI-surface detector still finds the known surfaces, so the guard cannot pass
  vacuously if detection breaks.

AI surfaces are **auto-detected** by their dependency on `ai`, `@ai-sdk/*` or `@google/genai`,
so a new AI module is covered the day it is added. Two surfaces call providers over plain
HTTP (`luma.ts`) or are the prompt payload itself (`loui-prompt.ts`) and are listed
explicitly; the detector test pins both lists.

On failure the guard prints the offending chain, e.g.
`app/api/loui/route.ts → lib/loui-prompt.ts → lib/helper.ts → lib/mls/listings.ts`.

### 2. Type brand — `src/lib/mls/licensed-content.ts`

`MlsLicensed<T>` marks a value as coming from the feed. `AiSafe<T>` collapses to `never`
for marked values, so a prompt-building signature typed `AiSafe<string>` rejects MLS content
**at compile time**, at the exact line of the leak. Verified: passing `MlsLicensed<string>`
yields `TS2345: Argument of type 'MlsLicensed<string>' is not assignable to parameter of
type 'never'`.

Display is an authorized use (§ III.A), so `declassifyForDisplay()` is the single, greppable
escape hatch. Its appearance inside any AI module is itself the violation.

## Consequences

- The price-recommendation feature cannot use MLS comps. Either it keeps a non-MLS source,
  or it becomes a deterministic (non-AI) calculation over MLS data, or it is dropped. This
  is a product decision that § III.B.4 forces, not an implementation detail.
- Loui must never receive listing content from the feed. Its knowledge of inventory has to
  come from Lixtara's own `properties` table, which is not Licensed Content.
- The Media Intelligence Agent must keep operating only on seller-uploaded photos. Its
  current mock-only, `property_photos`-only design already complies; the guard keeps it that
  way.
- When the feed reader is built it must return `MlsLicensed<T>` from a single chokepoint, or
  the type control is inert. The import guard is unconditional and does not depend on this.

## Alternatives rejected

- **Direct-import check only.** The clause says *indirectly*; one hop of indirection would
  defeat it.
- **A rule that no module may import both an AI surface and the MLS module.** Blunt: the
  root layout renders the Loui widget, so any page showing MLS listings would trip it.
  Co-location is not data flow. The type brand catches the real case without false positives.
- **Runtime scanning of prompts for MLS markers.** Fragile, catches the leak after it is
  written, and gives no signal at review time.
- **A written policy and code review.** The failure is silent and the counterparty may
  terminate at its sole discretion (§ VI.B.7).
