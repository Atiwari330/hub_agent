# Q2 2026 Analysis — SUPPLEMENTAL (Gap Coverage)
*Generated 2026-03-31*

---

## GAP 1: Data Integrity Investigation

### Total deals in database

| Filter | Count |
|--------|-------|
| All deals in DB (any pipeline) | 1967 |
| Sales pipeline deals only | 1887 |
| Non-sales-pipeline deals | 80 |

### Pipeline distribution

| Pipeline ID | Count |
|-------------|-------|
| 1c27e5a3-5e5e-4403-ab0f-d356bf268cf3 ← SALES | 1887 |
| 130845758 | 80 |

### Missing hubspot_created_at

| Category | Count |
|----------|-------|
| Sales deals WITH hubspot_created_at | 980 |
| Sales deals WITHOUT hubspot_created_at | 907 |

Missing-create-date deals: DB created_at range: 2025-12-31 to 2025-12-31

Of the 907 missing-create-date deals:
- 0 have closed_won_entered_at (closed won but we don't know when created)
- 0 have demo_completed_entered_at
- 764 have an amount set
- 0 have an owner assigned

**Stage distribution of deals missing hubspot_created_at:**

| Stage | Count |
|-------|-------|
| Closed Lost | 804 |
| Closed Won | 102 |
| SQL/Discovery | 1 |

Close date range for missing-create-date deals: 2021-06-16 to 2025-12-31

| Close Date Year | Count |
|----------------|-------|
| 2021 | 57 |
| 2022 | 277 |
| 2023 | 143 |
| 2024 | 325 |
| 2025 | 105 |

### Impact on our conversion rate analysis

**Closed-won deals: with vs without hubspot_created_at**

| Quarter Closed | Total Won | With Create Date | Missing Create Date | ARR Missing |
|---------------|-----------|-----------------|--------------------|--------------------|
| Q1 2025 | 6 | 6 | 0 | $0 |
| Q2 2025 | 5 | 5 | 0 | $0 |
| Q3 2025 | 5 | 5 | 0 | $0 |
| Q4 2025 | 9 | 9 | 0 | $0 |
| Q1 2026 | 10 | 10 | 0 | $0 |

**Verdict:** If "Missing Create Date" is 0 across the board, our cohort analysis is not missing any closed-won deals — the 907 deals without create dates are older/irrelevant deals that never closed.

## GAP 2: Per-AE Historical Performance vs. Q2 Targets

Has any AE ever hit their Q2 target in a single quarter?

### Christopher Garraffa (cgarraffa@opusbehavioral.com) — Q2 Target: $400,000

Total deals in pipeline: 201
Total closed-won (all time): 9

| Quarter | Deals Created | Demo Completed | Closed Won | Won ARR | Avg Size |
|---------|--------------|----------------|------------|---------|----------|
| Q1 2025 | 1 | 1 | 0 | $0 | N/A |
| Q2 2025 | 10 | 4 | 0 | $0 | N/A |
| Q3 2025 | 10 | 7 | 0 | $0 | N/A |
| Q4 2025 | 43 | 19 | 4 | $77,544 | $19,386 |
| Q1 2026 | 136 | 27 | 5 | $109,744 | $21,949 |

**Best quarter:** Q1 2026 at $109,744
**Q2 target ($400,000) is 3.6x their best quarter**
**All-time total closed-won ARR:** $187,288

**Personal conversion rates (all time):**
- Create → Demo: 28.9% (58/201)
- Demo → Won: 15.5% (9/58)
- Avg cycle time: 64 days (median 42)

**Closed-won deals:**
- Brianna Marshall - Therapy with Purpose — $19,028 — Closed 2026-03-27
- Kevin Day - Lifegate Freedom Recovery Ministries — $39,864 — Closed 2026-03-27
- All of You Counseling | John Casteel — $13,860 — Closed 2026-02-24
- Pathways Counseling Center Inc. - Software Finder — $9,216 — Closed 2026-02-19
- Arbit Counseling  — $27,776 — Closed 2026-01-30
- Central Home Health Services | Celeste Elliot | Metta Vibes referral — $12,420 — Closed 2025-12-31
- ATR Integrated - New Deal | Metta Vibes Referral — $11,400 — Closed 2025-11-24
- Alpine Springs Addiction Treatment - Robert's Referral — $44,004 — Closed 2025-11-13
- Metta Vibez | New Deal | v2 — $9,720 — Closed 2025-10-29

---

### Jack Rice (jrice@opusbehavioral.com) — Q2 Target: $300,000

Total deals in pipeline: 120
Total closed-won (all time): 3

| Quarter | Deals Created | Demo Completed | Closed Won | Won ARR | Avg Size |
|---------|--------------|----------------|------------|---------|----------|
| Q1 2025 | 0 | 0 | 0 | $0 | N/A |
| Q2 2025 | 0 | 0 | 0 | $0 | N/A |
| Q3 2025 | 0 | 0 | 0 | $0 | N/A |
| Q4 2025 | 13 | 3 | 0 | $0 | N/A |
| Q1 2026 | 107 | 11 | 3 | $58,548 | $19,516 |

**Best quarter:** Q1 2026 at $58,548
**Q2 target ($300,000) is 5.1x their best quarter**
**All-time total closed-won ARR:** $58,548

**Personal conversion rates (all time):**
- Create → Demo: 11.7% (14/120)
- Demo → Won: 21.4% (3/14)
- Avg cycle time: 50 days (median 28)

**Closed-won deals:**
- Wild Tree Wellness — $33,588 — Closed 2026-03-31
- Spero Recovery Center - EHR/RCM — $19,380 — Closed 2026-03-30
- Kinan Behavioral Health - EHR — $5,580 — Closed 2026-02-16

---

### Adi Tiwari (atiwari@opusbehavioral.com) — Q2 Target: $90,000

Total deals in pipeline: 182
Total closed-won (all time): 23

| Quarter | Deals Created | Demo Completed | Closed Won | Won ARR | Avg Size |
|---------|--------------|----------------|------------|---------|----------|
| Q1 2025 | 61 | 47 | 6 | $159,150 | $26,525 |
| Q2 2025 | 20 | 20 | 5 | $115,387 | $23,077 |
| Q3 2025 | 18 | 14 | 5 | $164,070 | $32,814 |
| Q4 2025 | 11 | 8 | 5 | $154,572 | $30,914 |
| Q1 2026 | 4 | 4 | 2 | $35,088 | $17,544 |

**Best quarter:** Q3 2025 at $164,070
**Q2 target ($90,000) is 0.5x their best quarter**
**All-time total closed-won ARR:** $628,267

**Personal conversion rates (all time):**
- Create → Demo: 57.7% (105/182)
- Demo → Won: 21.9% (23/105)
- Avg cycle time: 77 days (median 57)

**Closed-won deals:**
- Avighna - Reopened — $18,900 — Closed 2026-02-23
- Life Balance Recovery - New Deal — $16,188 — Closed 2026-02-19
- Mindful Healing Works Wellness Center LLC (DBA Mindful Healing Works) - New Deal — $46,320 — Closed 2025-11-21
- Family Houston - Software Advice — $26,172 — Closed 2025-11-12
- Wil la mootk - Reopened — $25,008 — Closed 2025-10-21
- Shiloh Treatment Center - Purchased List — $47,592 — Closed 2025-10-07
- Ascend Behavioral Services — $9,480 — Closed 2025-10-02
- I Am Recovery - SAMHSA — $12,408 — Closed 2025-09-17
- NeuPath Mind Wellness - Paid Search — $10,800 — Closed 2025-09-12
- MY House -  Lead — $10,596 — Closed 2025-08-04
- True North Recovery - Software Advice — $89,508 — Closed 2025-08-01
- Sierra Family Therapy Center -  Google Search — $40,758 — Closed 2025-07-09
- Therapeutic Wellness Services - PPC Lead — $30,720 — Closed 2025-06-25
- Mariners Inn - Steve Johnson Deal — $23,683 — Closed 2025-05-16
- Insight Therapy - Purchased List — $36,000 — Closed 2025-05-13
- Raise the Future - George New Deal — $13,284 — Closed 2025-05-02
-  Acceptance Recovery Center - Direct Traffic — $11,700 — Closed 2025-04-01
- Christian Counseling — $56,484 — Closed 2025-03-26
- Rooted Life - Direct Traffic — $15,408 — Closed 2025-03-20
- Acumen Assessments — $7,338 — Closed 2025-03-18
- Somerset Mental Health - Organic Search — $34,608 — Closed 2025-03-13
- Suncoast UR - Software Advice — $18,000 — Closed 2025-02-20
- Rising Phoenix - New Deal — $27,312 — Closed 2025-02-04

---

### zclaussen@opusbehavioral.com — NOT FOUND IN DATABASE

### hgomez@opusbehavioral.com — NOT FOUND IN DATABASE

## GAP 3: Weekly Waterfall — When Must Demos & Leads Exist?

Using: $24,738 avg deal, 21.6% demo→won, 57.7% create→demo
Median demo→close: 48 days | Median create→close: 50 days

### If a deal needs to close by June 30...

| Week | Dates | Days Left in Q2 | Can demo→close? | Can create→close? | Status |
|------|-------|----------------|-----------------|-------------------|--------|
| Wk 1 (2026-04-01) | 2026-04-01 – 2026-04-07 | 90 | Yes | Yes | 🟢 Full funnel time |
| Wk 2 (2026-04-08) | 2026-04-08 – 2026-04-14 | 83 | Yes | Yes | 🟢 Full funnel time |
| Wk 3 (2026-04-15) | 2026-04-15 – 2026-04-21 | 76 | Yes | Yes | 🟢 Full funnel time |
| Wk 4 (2026-04-22) | 2026-04-22 – 2026-04-28 | 69 | Yes | Yes | 🟢 Full funnel time |
| Wk 5 (2026-04-29) | 2026-04-29 – 2026-05-05 | 62 | Yes | Yes | 🟢 Full funnel time |
| Wk 6 (2026-05-06) | 2026-05-06 – 2026-05-12 | 55 | Yes | Yes | 🟢 Full funnel time |
| Wk 7 (2026-05-13) | 2026-05-13 – 2026-05-19 | 48 | Yes | No (need 50d) | 🟡 Demo only — too late to create new |
| Wk 8 (2026-05-20) | 2026-05-20 – 2026-05-26 | 41 | No (need 48d) | No (need 50d) | 🔴 Too late for median deal |
| Wk 9 (2026-05-27) | 2026-05-27 – 2026-06-02 | 34 | No (need 48d) | No (need 50d) | 🔴 Too late for median deal |
| Wk 10 (2026-06-03) | 2026-06-03 – 2026-06-09 | 27 | No (need 48d) | No (need 50d) | 🔴 Too late for median deal |
| Wk 11 (2026-06-10) | 2026-06-10 – 2026-06-16 | 20 | No (need 48d) | No (need 50d) | 🔴 Too late for median deal |
| Wk 12 (2026-06-17) | 2026-06-17 – 2026-06-23 | 13 | No (need 48d) | No (need 50d) | 🔴 Too late for median deal |
| Wk 13 (2026-06-24) | 2026-06-24 – 2026-06-30 | 6 | No (need 48d) | No (need 50d) | 🔴 Too late for median deal |

### Cumulative Weekly Targets

To hit $925K by end of Q2, you need to be at or ahead of this pace:

| Week | Cumulative Leads (target) | Cumulative Demos (target) | Cumulative Closes (target) | Cumulative Revenue |
|------|--------------------------|--------------------------|---------------------------|-------------------|
| Wk 1 (2026-04-01) | 24 | 14 | 3 | $74,213 |
| Wk 2 (2026-04-08) | 47 | 27 | 6 | $148,426 |
| Wk 3 (2026-04-15) | 71 | 41 | 9 | $222,639 |
| Wk 4 (2026-04-22) | 94 | 54 | 12 | $296,852 |
| Wk 5 (2026-04-29) | 118 | 68 | 15 | $371,065 |
| Wk 6 (2026-05-06) | 142 | 82 | 18 | $445,278 |
| Wk 7 (2026-05-13) | 165 | 95 | 20 | $494,753 |
| Wk 8 (2026-05-20) | 189 | 109 | 23 | $568,966 |
| Wk 9 (2026-05-27) | 213 | 123 | 26 | $643,179 |
| Wk 10 (2026-06-03) | 236 | 136 | 29 | $717,392 |
| Wk 11 (2026-06-10) | 260 | 150 | 32 | $791,605 |
| Wk 12 (2026-06-17) | 283 | 163 | 35 | $865,818 |
| Wk 13 (2026-06-24) | 307 | 177 | 38 | $940,031 |

### Front-Loaded Reality Check

Because deals take ~50 days to close, leads generated after mid-May mostly won't close in Q2.
A realistic front-loaded model:

| Month | Leads Target | Demos Target | Closes Target | Revenue Target |
|-------|-------------|-------------|--------------|---------------|
| **April** (generation month) | **154** | **80** | 10 | $247,376 |
| **May** (demo + close month) | **107** | **62** | 13 | $321,589 |
| **June** (closing month) | 46 | 35 | **15** | $371,065 |
| **TOTAL** | 307 | 177 | 38 | $925,000 |

**Key insight:** April is the most critical month. 50% of all leads for the quarter must be in the pipeline by end of April to have enough time to progress through demos and close by June 30.

---

## UPDATED CONCLUSIONS

### Data Integrity
Check the "Missing Create Date" table above. If all closed-won deals in Q1 2025–Q1 2026 have `hubspot_created_at`, then the cohort rates are reliable. The ~900 deals without create dates are likely older pre-sync deals that don't affect recent conversion rate calculations.

### Per-AE Reality
Check each AE's "best quarter" vs their Q2 target. If Chris's best quarter was $44K and his target is $400K, that's a 9x jump. This isn't a math problem — it's a capacity and pipeline generation problem.

### Timing Waterfall
- **April:** Generate 50% of quarterly leads, start booking demos aggressively
- **May:** Continue lead gen (35%), complete majority of demos, start closing
- **June:** Closing month — leads created in June almost certainly won't close in Q2
- **After mid-May:** New lead creation has diminishing returns for Q2 revenue
