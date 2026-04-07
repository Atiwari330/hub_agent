# Q1 → Q2 2026 Hardcoding Audit

> Generated 2026-04-01. This document catalogs every hardcoded Q1 2026 reference in the codebase so that any developer (human or AI) can pick up the transition work without re-doing the research.

---

## Priority Legend

| Priority | Meaning |
|----------|---------|
| **P0 — CRITICAL** | Production-facing code that currently shows wrong data or defaults to Q1 |
| **P1 — HIGH** | Library/compute code that powers dashboards — needs updating for Q2 planning |
| **P2 — MEDIUM** | CLI scripts used regularly — should be parameterized or updated |
| **P3 — LOW** | One-off debug scripts, test fixtures, documentation — update if reused |

---

## P0 — CRITICAL (Production UI / API defaults stuck on Q1)

### 1. Demo Economics View — hardcoded `year=2026&quarter=1`
- **File:** `src/components/dashboard/demo-economics-view.tsx:326`
- **Code:** `const res = await fetch('/api/demo-economics?year=2026&quarter=1');`
- **Fix:** Use dynamic quarter: fetch current quarter from `getCurrentQuarter()` or compute client-side. The API already accepts `year`/`quarter` params and defaults to current quarter — the component just isn't using the defaults.

### 2. Lead Source Dashboard — hardcoded start date `2026-01-01`
- **File:** `src/components/dashboard/lead-source-dashboard.tsx:70`
- **Code:** `const [startDate, setStartDate] = useState('2026-01-01');`
- **Fix:** Compute Q start date dynamically. For Q2 this should be `2026-04-01`. Consider using `getQuarterInfo(getCurrentQuarter())` to derive the start date.

### 3. Lead Source API — hardcoded fallback `2026-01-01`
- **File:** `src/app/api/dashboard/lead-source-analysis/route.ts:75`
- **Code:** `const startDate = searchParams.get('startDate') || '2026-01-01';`
- **Fix:** Replace with dynamic current-quarter start: `getQuarterInfo(getCurrentQuarter()).startDate`.

---

## P1 — HIGH (Q2 Goal Tracker — entire module is Q2-specific)

The Q2 Goal Tracker is purpose-built for Q2 planning using Q1 as the benchmark quarter. As we enter Q2, this module needs a decision: **keep it as-is** (it's still relevant during Q2 since it's tracking Q2 goals), or **generalize it** for Q3 planning when Q2 ends.

### 4. Q2 Goal Tracker compute — hardcoded Q1 2026 rate calculations
- **File:** `src/lib/q2-goal-tracker/compute.ts`
- **Lines 155–221:** Function `computeQ1_2026ClosingRates()` hardcodes `getQuarterInfo(2026, 1)` and date range `2026-01-01` to `2026-03-31`
- **Lines 235–242:** Rate set labeled `'Q1 2026'` as default
- **Lines 260–265:** Lead source rates from `getQuarterInfo(2026, 1)`
- **Line 313:** `getQuarterInfo(2026, 1)` in all-quarters array
- **Line 345:** `getQuarterInfo(2026, 2)` for weekly actuals (correct for Q2)
- **Line 423:** `teamTarget: 925000` — hardcoded Q2 team target
- **Status:** This module is **intentionally** Q2-focused. During Q2, it's still the active tracker. No change needed now, but when Q3 planning starts, a similar module or generalization will be needed.

### 5. Q2 Goal Tracker view — default rate set label
- **File:** `src/components/dashboard/q2-goal-tracker-view.tsx:72`
- **Comment:** `// Default to first rate set (Q1 2026)`
- **Status:** Cosmetic — the Q1 rates are the historical benchmark, which is correct while in Q2.

### 6. Q2 Goal Tracker naming throughout the system
- **Files:**
  - `src/app/dashboard/q2-goal-tracker/page.tsx` — page route
  - `src/app/api/q2-goal-tracker/route.ts` — API route
  - `src/components/dashboard/q2-goal-tracker-view.tsx` — view component
  - `src/components/dashboard/sidebar.tsx:418-433` — nav link labeled "Q2 Goal Tracker"
  - `src/lib/auth/types.ts:50` — `Q2_GOAL_TRACKER` resource constant
  - `src/lib/auth/types.ts:149,221` — path-to-resource mappings
- **Decision needed:** Is this a generic "Goal Tracker" that should be renamed, or will we build a new Q3 version later?

### 7. Demo Economics API — hardcoded Q1 fallback values
- **File:** `src/app/api/demo-economics/route.ts:51-52`
- **Code:**
  ```typescript
  const avgDeal = counts.avgDealSize || 17332; // fallback to Q1 actual
  const closeRate = counts.closeRate || 0.375;
  ```
- **Fix:** These fallbacks are only used when computed values are unavailable. Update the comment and consider whether Q1 actuals are still the best fallback for Q2.

---

## P2 — MEDIUM (CLI scripts used for ongoing analysis)

### 8. `stage-counts.ts` — defaults to year=2026, quarter=1
- **File:** `src/scripts/stage-counts.ts:49-50`
- **Code:** `let year = 2026; let quarter = 1;`
- **Fix:** Use `getCurrentQuarter()` for defaults. The script already accepts `--year` and `--quarter` flags.

### 9. `town-hall-data.ts` — hardcoded Q1 2026 constants
- **File:** `src/scripts/town-hall-data.ts:30-35`
- **Code:**
  ```typescript
  const Q_LABEL = 'Q1 2026';
  const Q_START_DATE = '2026-01-01';
  const Q_END_DATE = '2026-03-31';
  const Q_START_TS = '2026-01-01T00:00:00.000Z';
  const Q_END_TS = '2026-03-31T23:59:59.999Z';
  ```
- Also line 95: `.eq('fiscal_year', 2026).eq('fiscal_quarter', 1)`
- **Fix:** Parameterize with `--year`/`--quarter` flags or use `getCurrentQuarter()`.

### 10. `validate-rates.ts` — hardcoded Q1 2026 analysis
- **File:** `src/scripts/validate-rates.ts:68-97`
- **Code:** `getQuarterInfo(2026, 1)`, date comparisons `>= '2026-01-01' && <= '2026-03-31'`
- **Fix:** Parameterize or update to Q2 dates if rerunning.

### 11. `check-ae-stage-data.ts` — hardcoded Q1 range
- **File:** `src/scripts/check-ae-stage-data.ts:21-24`
- **Code:** `const q1Start = '2026-01-01'; const q1End = '2026-03-31';`
- **Fix:** Parameterize with CLI args.

---

## P2 — MEDIUM (Q2-specific analysis scripts)

These were built for Q2 planning and reference Q1 as historical data. They're Q2-aware but have hardcoded Q2 dates too.

### 12. `q2-reverse-engineer.ts` — Q2 analysis script
- **File:** `src/scripts/q2-reverse-engineer.ts`
- **Key lines:** 148, 158, 371-375, 413, 432, 565-570
- **Hardcoded:** `getQuarterInfo(2026, 1)` for Q1 benchmark, `$925,000` target, `new Date('2026-06-30')` for Q2 end
- **Status:** This is a point-in-time analysis script for Q2 planning. Leave as-is (historical artifact).

### 13. `q2-cohort-analysis.ts` — Q2 cohort script
- **File:** `src/scripts/q2-cohort-analysis.ts`
- **Key lines:** 117, 123, 226, 273, 338, 382-383, 566
- **Hardcoded:** `getQuarterInfo(2026, 1)`, `Q2_TARGET = 925000`, `new Date('2026-04-01')` / `new Date('2026-06-30')`
- **Status:** Historical analysis script. Leave as-is.

### 14. `q2-gaps-analysis.ts` — Q2 gap analysis
- **File:** `src/scripts/q2-gaps-analysis.ts`
- **Key lines:** 226, 373, 382-383, 419
- **Hardcoded:** `getQuarterInfo(2026, 1)`, `Q2_TARGET = 925000`, Q2 date range
- **Status:** Historical analysis script. Leave as-is.

---

## P3 — LOW (Debug scripts, test fixtures, documentation)

### 15. `debug-week6-chris.ts` — Week 6 debug (Feb 2-8 2026)
- **File:** `src/scripts/debug-week6-chris.ts:21-27`
- **Hardcoded:** `WEEK6_START`, `WEEK6_END`, `Q1_START`, `Q1_END` — all Jan-Mar 2026
- **Status:** One-off debug script. Leave as-is.

### 16. `demo-completed-last-week.ts` — Jan 26 - Feb 1 2026
- **File:** `src/scripts/demo-completed-last-week.ts:17-19`
- **Hardcoded:** Specific week dates in January/February 2026
- **Status:** One-off script. Leave as-is.

### 17. `verify-hubspot-close-dates.ts` — March 2026 verification
- **File:** `src/scripts/verify-hubspot-close-dates.ts:16`
- **Hardcoded:** `.eq('close_date', '2026-03-31')`
- **Status:** One-off debug. Leave as-is.

### 18. `check-adi-deals.ts` — 2026 deal check
- **File:** `src/scripts/check-adi-deals.ts:36`
- **Hardcoded:** `.gte('close_date', '2026-01-01')`
- **Status:** One-off debug. Leave as-is.

### 19. `test-proactive-intelligence.ts` — March 2026 test dates
- **File:** `src/scripts/test-proactive-intelligence.ts:47-49`
- **Hardcoded:** `new Date('2026-03-23...')`, `new Date('2026-03-27...')`
- **Status:** Test fixture. Leave as-is.

### 20. `investigate-shannon-deal.ts` — Jan 2026 investigation
- **File:** `src/scripts/investigate-shannon-deal.ts:23, 218, 262`
- **Hardcoded:** January 2026 email date filtering
- **Status:** One-off investigation. Leave as-is.

### 21. `test-next-step-analysis.ts` — example dates in test cases
- **File:** `src/scripts/test-next-step-analysis.ts:14-15`
- **Hardcoded:** `'Demo scheduled for Jan 15th 2026'`, `'Follow up on January 20, 2026'`
- **Status:** Test data. Low priority but could update if tests are rerun.

### 22. AI prompt examples — dates in few-shot examples
- **File:** `src/lib/ai/analyze-next-step.ts:81, 84`
- **Code:** `"dueDate":"2026-01-15"` and `"dueDate":"2026-01-07"` in LLM prompt examples
- **Status:** These are few-shot examples. The dates don't affect behavior — the LLM extracts dates from actual deal data. Low priority cosmetic update.

### 23. Database migration — Q1 2026 quota seed
- **File:** `supabase/migrations/006_q1_2026_quotas.sql`
- **Content:** Seeds `quotas` and `ae_targets` tables with fiscal_year=2026, fiscal_quarter=1
- **Status:** This is historical migration data — it's already been applied. Q2 quotas need a NEW migration (not an edit to this one). See action items below.

### 24. Documentation files
- **Files:** `q2-2026-reverse-engineering.md`, `q2-2026-supplemental.md`
- **Status:** Reference documents for Q2 planning. Leave as-is.

---

## Confirmed SAFE — Already Dynamic

These files use `getCurrentQuarter()` or parameterized queries and will automatically work for Q2:

| File | How it's dynamic |
|------|-----------------|
| `src/lib/utils/quarter.ts` | `getCurrentQuarter()` computes from system date |
| `src/lib/utils/forecast.ts` | Generic quarterly forecast, no hardcoded dates |
| `src/app/api/demo-economics/route.ts` | Uses `getCurrentQuarter()` for defaults (except fallback values) |
| `src/app/api/ae/[ownerId]/weekly-pipeline/route.ts` | Uses `getCurrentQuarter()` |
| `src/app/api/ae/[ownerId]/quota/route.ts` | Uses `getCurrentQuarter()` |
| `src/app/api/ae/[ownerId]/forecast/route.ts` | Parameterized fiscal_year/fiscal_quarter |
| `src/app/api/dashboard/quarterly-summary/route.ts` | Uses `getCurrentQuarter()` |
| `src/app/api/dashboard/weekly-summary/route.ts` | Uses `getCurrentQuarter()` |
| `src/app/api/cron/demo-tracker/route.ts` | Parameterized fiscal_year/fiscal_quarter |
| `src/app/api/cron/hot-tracker/route.ts` | Parameterized fiscal_year/fiscal_quarter |
| `src/components/dashboard/quarterly-dashboard.tsx` | Renders from API data |
| `src/components/dashboard/target-progress.tsx` | Fetches from API |
| `src/lib/scorecard/daily-scorecard.ts` | No quarter hardcoding |
| `src/lib/scorecard/weekly-scorecard.ts` | No quarter hardcoding |
| `src/lib/scorecard/prospect-tiers.ts` | No quarter hardcoding |
| `src/lib/ai/tools/*` | No quarter hardcoding |

---

## Action Items Summary

### Must fix now (P0):
1. [x] `demo-economics-view.tsx` — remove hardcoded `year=2026&quarter=1`, let API use its own defaults ✅ DONE
2. [x] `lead-source-dashboard.tsx` — compute start date from current quarter dynamically ✅ DONE
3. [x] `lead-source-analysis/route.ts` — compute fallback start date from current quarter ✅ DONE

### Should fix soon (P1):
4. [ ] Create `supabase/migrations/XXX_q2_2026_quotas.sql` with Q2 2026 quota amounts (user needs to provide Q2 quota values per AE)
5. [ ] Update `demo-economics/route.ts` fallback values comment (and optionally the values themselves)
6. [ ] Decide: rename "Q2 Goal Tracker" → generic "Goal Tracker", or keep as Q2-specific until Q2 ends

### Nice to have (P2):
7. [x] `stage-counts.ts` — change defaults to use `getCurrentQuarter()` ✅ DONE
8. [x] `town-hall-data.ts` — parameterize quarter constants with `--year`/`--quarter` flags ✅ DONE
9. [ ] `validate-rates.ts` — parameterize quarter
10. [ ] `check-ae-stage-data.ts` — parameterize quarter

### Leave as-is (P3):
- Debug scripts (items 15-20) — historical artifacts
- Test fixtures (item 21) — cosmetic only
- AI prompt examples (item 22) — doesn't affect behavior
- Q1 migration (item 23) — already applied, needs new migration not edit
- Documentation (item 24) — reference material
