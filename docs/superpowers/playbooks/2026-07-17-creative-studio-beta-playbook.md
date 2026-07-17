# Creative Studio v1 — Private Beta Playbook

**Goal:** Learn from real usage with the least possible blast radius. Start with **5 real listings**, follow them
by hand, and let user behavior — not our imagination — decide the next iteration.
**Precondition:** the Production Runbook Step 10 Go/No-Go passed (smoke test green, rollback verified, owner GO).
**Feature is frozen:** no new functionality during beta. The only changes allowed are bug fixes to what already ships.

---

## Guiding principle (the one rule)
Before building anything new, answer: **"Did a beta user ask for this, or are we guessing?"**
- "We're imagining it" → park it.
- "Three different users hit the same wall" → that becomes the next priority.
The product should now learn more from users than from architects.

---

## Cohort 1 — five listings
**Who:** 5 real, approved listings with enough photos (owner-selected; ideally a mix — a clean listing, a sparse one,
a large-photo-set one) so we see the readiness gate and the happy path both.
**How they get in:** the feature is flag-on; entry is controlled by *which sellers have a listing on the account*, not
by a code gate. Keep the circle to these 5 during Cohort 1. Do not announce broadly.
**Follow-up:** manual. For each of the 5, the owner personally checks the outcome (did they find it, click it, get a
video, download it, hit an error) and notes it. Five is small enough to watch every single render by hand.

---

## What to observe (minimal metric set)
Track ONLY these at first. If analytics isn't wired yet, run the SQL below against prod (read-only).

| Metric | Question it answers | Source |
|---|---|---|
| Panel impressions | Do sellers even see it? | analytics event `panel_view`, or infer from dashboard loads |
| `Create listing video` clicks | Do they try it? | analytics `create_click` / count of created jobs |
| Completion rate | Does it finish? | completed jobs ÷ created jobs |
| Avg time to ready | Is "a few minutes" honest? | `completed.metadata` render time, or job timestamps |
| Preview clicks | Do they watch before downloading? | analytics `preview_click` |
| Download clicks | Do they keep the output? | analytics `download_click` |
| Retry rate | How often does it fail then succeed? | jobs with attempts>1, or `retry` events |
| Errors | What breaks, and is it transient? | failed jobs by `error_code` + Sentry |

**SQL you can run today (no analytics needed):**
```sql
-- created / completed / failed in the last 7 days
select state, count(*) from creative_jobs
where created_at > now() - interval '7 days' group by state;

-- completion rate
select round(100.0 * sum((state='completed')::int) / nullif(count(*),0), 1) as pct_complete
from creative_jobs where created_at > now() - interval '7 days';

-- retries (jobs that needed more than one attempt)
select count(*) from creative_jobs where attempts > 1 and created_at > now() - interval '7 days';

-- failures by structured code
select error_code, count(*) from creative_jobs
where state='failed' and created_at > now() - interval '7 days' group by error_code order by 2 desc;

-- exactly-once integrity (must stay 0 — a nonzero row is a Sev-1)
select listing_id, count(*) from assets where kind='video' group by listing_id having count(*) > 1;
```
Watch Sentry for sanitized `Creative job failed: <CODE>` events alongside these.

---

## Daily rhythm during Cohort 1
1. Morning: run the 4 SQL blocks; skim Sentry.
2. For any failure: read the `error_code`, decide **transient** (timeout, signing hiccup → expected, retry works) vs
   **systemic** (same code repeating, artifact/bucket/permission → stop & fix).
3. Note each of the 5 sellers' journey (saw it? clicked? finished? downloaded? stuck where?).
4. Confirm the exactly-once integrity query is still `0 rows`. If not → **Sev-1, hit the kill switch** (unset the flag),
   investigate before any further renders.

---

## Stop criteria (pull the flag immediately if ANY occur)
- The exactly-once query returns a duplicate (>1 video asset for a listing).
- Orphaned Storage objects or leaked assets on failed jobs.
- Cost per render materially above budget.
- A **systemic** failure code repeating across listings (not a one-off transient).
- Any seller-visible broken/confusing state that copy can't soften.
Kill switch = unset `CREATIVE_STUDIO_VIDEO_ENABLED` (panel unmounts + route 404s; in-flight jobs swept). Then fix,
re-run the Runbook smoke test, and only then resume.

---

## Expand criteria (open to the next group only when ALL hold)
- [ ] ≥ 4 of 5 Cohort-1 listings produced a video the seller previewed and/or downloaded.
- [ ] Completion rate ≥ an agreed threshold (suggest ≥ 90% of *ready* listings; readiness-gate 422s don't count as failures).
- [ ] Zero exactly-once violations, zero orphans, across the whole cohort.
- [ ] No systemic error code; only transient failures that retry resolved.
- [ ] Cost per render within budget, extrapolated to the next cohort size.
- [ ] Owner GO.

**Next cohorts:** grow slowly — e.g. 5 → ~20 → ~50 → open. Re-check the same stop/expand criteria at each step. Never
jump straight to "everyone."

---

## What NOT to build during beta (frozen list)
Regeneration, multiple templates, provider selection, additional AI, cost/credits UI, multi-format output,
auto-publish/Distribution, Tour Engine, extra buttons/options. Each of these waits for a real, repeated user signal per
the guiding principle above.

---

## Feeding learning back
Keep a running "beta findings" note: one line per observation (seller, what happened, transient/systemic, quote if any).
After Cohort 1, the top *repeated* frictions — not the architects' wishlist — become the v1.1 candidate list, which then
re-enters the normal brainstorm → spec → plan → gated-implementation loop.
