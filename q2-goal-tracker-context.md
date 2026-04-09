# Q2 2026 Goal Tracker — Full Context

## What This Is

The Q2 Goal Tracker is an internal dashboard for Opus Behavioral Health's sales team. It reverse-engineers the activity required to hit the team's **$925,000 ARR** target for Q2 2026 (April 1 – June 30). The dashboard is interactive — users can adjust assumption sliders (avg deal size, conversion rates, cycle time) and see all downstream numbers recalculate instantly.

---

## The Core Formula (Reverse-Engineering Logic)

The tracker works backwards from the $925K target through three rows:

### Row 1: Total Team Requirement (No Pipeline Credit)
```
$925K Target ÷ Avg Deal Size = Deals Needed to Close
Deals Needed ÷ Demo→Won Rate = Demos Needed
Demos Needed ÷ Create→Demo Rate = Leads (Deals) Needed to Create
```

### Row 2: Pipeline Credit (What's Already In-Flight)
```
Post-Demo Pipeline (raw ARR) × Demo→Won Rate = Post-Demo Weighted
Pre-Demo Pipeline (raw ARR) × Create→Demo Rate × Demo→Won Rate = Pre-Demo Weighted
Total Weighted Pipeline = Post-Demo Weighted + Pre-Demo Weighted
Gap = $925K − Total Weighted Pipeline
```

### Row 3: New Q2 Activity Needed (The Actual Work)
```
Gap ÷ Avg Deal Size = New Closes Needed
New Closes ÷ Demo→Won Rate = New Demos Needed
New Demos ÷ Create→Demo Rate = New Leads Needed
```

---

## Conversion Rate Sources (Two Cohort Options)

Users can toggle between two rate sets to see how assumptions change the math:

### Rate Set 1: Q1 2026 (Default — Most Recent Quarter)
Based on deals that **closed won in Q1 2026**.

| Metric | Value |
|--------|-------|
| Avg Deal Size | $19,655 |
| Demo → Won Rate | 27.3% (12 won / 44 demos) |
| Create → Demo Rate | 17.3% (44 demos / 254 deals created) |
| Avg Cycle Time (create → close) | 59 days |
| Avg Demo → Close Time | 52 days |
| Avg Create → Demo Time | 11 days |
| Total Closed-Won ARR | $235,864 |

**Q1 2026 Closed-Won Deals (12):**

| Deal | Owner | ARR | Closed Date |
|------|-------|-----|-------------|
| Kevin Day - Lifegate Freedom Recovery Ministries | Christopher Garraffa | $39,864 | 2026-03-27 |
| Wild Tree Wellness | Jack Rice | $33,588 | 2026-03-31 |
| Arbit Counseling | Christopher Garraffa | $27,776 | 2026-01-30 |
| Kinder in the Keys Treatment Center - EHR | Jack Rice | $19,968 | 2026-03-31 |
| Spero Recovery Center - EHR/RCM | Jack Rice | $19,380 | 2026-03-30 |
| Brianna Marshall - Therapy with Purpose | Christopher Garraffa | $19,028 | 2026-03-27 |
| Avighna - Reopened | Adi Tiwari | $18,900 | 2026-02-23 |
| Life Balance Recovery - New Deal | Adi Tiwari | $16,188 | 2026-02-19 |
| All of You Counseling - John Casteel | Christopher Garraffa | $13,860 | 2026-02-24 |
| Liv Recovery - Todd Wilson | Christopher Garraffa | $12,516 | 2026-03-31 |
| Pathways Counseling Center Inc. | Christopher Garraffa | $9,216 | 2026-02-19 |
| Kinan Behavioral Health - EHR | Jack Rice | $5,580 | 2026-02-16 |

### Rate Set 2: Q1-Q4 2025 (Larger Historical Sample)
Based on deals **created** in any 2025 quarter that eventually closed won.

| Metric | Value |
|--------|-------|
| Avg Deal Size | $24,738 |
| Demo → Won Rate | 21.6% (25 won / 116 demos) |
| Create → Demo Rate | 57.4% (116 demos / 202 deals created) |
| Avg Cycle Time (create → close) | 67 days |
| Avg Demo → Close Time | 61 days |
| Avg Create → Demo Time | 10 days |
| Total Closed-Won ARR | $618,441 |
| Sample Size | 25 closed-won deals |

---

## Calculated Requirements (Using Default Q1 2026 Rates)

Plugging the Q1 2026 rates into the formula:

### Row 1: Total Requirement (Ignoring Pipeline)
- **Deals to Close:** ceil($925,000 / $19,655) = **48 deals**
- **Demos Needed:** ceil(48 / 0.273) = **176 demos**
- **Leads Needed:** ceil(176 / 0.173) = **1,018 leads**

### Row 2: Pipeline Credit
- **Post-Demo Raw ARR:** $3,033,598 (33 deals past demo stage)
- **Post-Demo Weighted:** $3,033,598 × 0.273 = **$828,172**
- **Pre-Demo Raw ARR:** $171,000 (91 deals pre-demo)
- **Pre-Demo Weighted:** $171,000 × 0.173 × 0.273 = **$8,076**
- **Total Weighted Pipeline:** ~$836,248
- **Gap:** $925,000 − $836,248 = **~$88,752**

### Row 3: New Activity Needed (The Gap)
- **New Closes Needed:** ceil($88,752 / $19,655) = **~5 deals**
- **New Demos Needed:** ceil(5 / 0.273) = **~19 demos**
- **New Leads Needed:** ceil(19 / 0.173) = **~110 leads**

---

## Team-Confirmed Pipeline (AE Triage Exercise)

These are specific deals where AEs said "yes, this is likely to close in Q2":

**Total Team Forecast: $428,664 (15 deals)**

| AE | Deal Count | Forecast ARR |
|----|-----------|--------------|
| Christopher Garraffa | 11 deals | $361,500 |
| Jack Rice | 2 deals | $42,000 |
| Adi Tiwari | 2 deals | $25,164 |

**Top Post-Demo Deals (by amount):**

| Deal | Owner | Stage | Amount | Days in Pipeline |
|------|-------|-------|--------|-----------------|
| Mindful Therapy Group - Conference | Adi Tiwari | Proposal/Evaluating | $1,200,000 | 418 |
| New Season - Huntsville - Terry Mitchell | Christopher Garraffa | Demo Completed | $1,000,000 | 126 |
| Lillian Ingram - Learning To Achieve Wellness | Christopher Garraffa | Proposal/Evaluating | $140,000 | 11 |
| AARS Alaska / Nugen's Ranch | Adi Tiwari | Demo Completed | $122,004 | 57 |
| Honey Lake Clinic - Caitlyn Morgan | Christopher Garraffa | Qualified/Validated | $100,000 | 64 |
| Karolyn Worrell - Family Therapy Associates | Christopher Garraffa | Proposal/Evaluating | $58,000 | 14 |
| CMETFL - Eileen Rojas | Christopher Garraffa | Proposal/Evaluating | $50,000 | 51 |
| Gastineau Human Services | Christopher Garraffa | Proposal/Evaluating | $45,000 | 16 |
| New Horizons Recovery Center | Jack Rice | Qualified/Validated | $30,000 | 64 |
| Patrick Gallagher - Beecon Recovery | Christopher Garraffa | Proposal/Evaluating | $30,000 | 26 |
| Rebuilt Treatment - Jared Referral | Adi Tiwari | Demo Completed | $27,588 | 5 |
| Ramona Charles - Structured Family Interventions | Christopher Garraffa | Qualified/Validated | $25,000 | 56 |
| Serenity Outpatient Services | Christopher Garraffa | Proposal/Evaluating | $18,000 | 43 |
| Railbelt Mental Health and Addictions | Christopher Garraffa | Proposal/Evaluating | $17,500 | 21 |
| Mirta Cabrera | Christopher Garraffa | Proposal/Evaluating | $15,000 | 79 |

---

## Per-AE Targets & History

| AE | Q2 Target | Best Quarter Ever | Best Qtr ARR | All-Time Won ARR | Deals Won | Personal Demo→Won | Personal Create→Demo |
|----|-----------|-------------------|-------------|------------------|-----------|-------------------|---------------------|
| Christopher Garraffa | $400,000 | Q1 2026 | $122,260 | $199,804 | 10 | 16.1% | 28.6% |
| Jack Rice | $300,000 | Q1 2026 | $78,516 | $78,516 | 4 | 22.2% | 14.5% |
| Adi Tiwari | $90,000 | Q3 2025 | $164,070 | $628,267 | 23 | 21.3% | 58.4% |
| Zach Claussen | $90,000 | No data | $0 | $0 | 0 | N/A | N/A |
| Hector Gomez | $25,000 | No data | $0 | $0 | 0 | N/A | N/A |

**Sum of AE targets: $905,000** (slightly below $925K team target; delta accounts for team-level pipeline deals)

---

## Lead Source Conversion Rates (Q1 2026 Data)

| Source | Deals Created | Demos Completed | Create → Demo Rate |
|--------|--------------|-----------------|-------------------|
| Paid Lead (PPL) | 192 | 16 | 8.3% |
| PPC | 20 | 8 | 40.0% |
| Website | 12 | 4 | 33.3% |
| Event | 10 | 6 | 60.0% |
| Organic | 9 | 6 | 66.7% |
| (no lead source) | 6 | 3 | 50.0% |
| List | 5 | 1 | 20.0% |

**Note:** Paid Leads are the highest volume (192 deals) but lowest conversion (8.3%). Events and Organic have the highest conversion rates but low volume.

---

## Q2 Progress & Timeline (As of April 8, 2026)

| Metric | Value |
|--------|-------|
| Days Elapsed | 9 of 92 |
| Percent Complete | 9.8% |
| Current Week | Week 2 of 13 |
| Closed-Won ARR in Q2 So Far | $0 |
| Deals Closed in Q2 So Far | 0 |

### Weekly Pacing Target
Linear pacing: $925,000 / 13 weeks = **~$71,154/week**

| Week | Dates | Cumulative Target |
|------|-------|-------------------|
| 1 | Apr 1–8 | $71,154 |
| 2 | Apr 8–15 | $142,308 |
| 3 | Apr 15–22 | $213,462 |
| 4 | Apr 22–29 | $284,615 |
| 5 | Apr 29–May 6 | $355,769 |
| 6 | May 6–13 | $426,923 |
| 7 | May 13–20 | $498,077 |
| 8 | May 20–27 | $569,231 |
| 9 | May 27–Jun 3 | $640,385 |
| 10 | Jun 3–10 | $711,538 |
| 11 | Jun 10–17 | $782,692 |
| 12 | Jun 17–24 | $853,846 |
| 13 | Jun 24–Jul 1 | $925,000 |

### Deadline Zones (Using Q1 2026 Rates)
- **Lead Creation Deadline:** ~59 days before June 30 = **~May 2** (after this, new leads won't close in Q2)
- **Demo Completion Deadline:** ~52 days before June 30 = **~May 9** (after this, new demos won't close in Q2)
- **Green Zone (full cycle available):** Weeks 1–4
- **Yellow Zone (demo-only, no new leads):** Weeks 5–6
- **Red Zone (only existing pipeline can close):** Weeks 7–13

---

## Pipeline Stages (Sales Pipeline)

| Stage | Role in Tracker |
|-------|----------------|
| MQL | Pre-demo (weighted by create→demo × demo→won) |
| SQL/Discovery | Pre-demo |
| Demo Scheduled | Pre-demo |
| Demo Completed | Post-demo (weighted by demo→won only) |
| Qualified/Validated | Post-demo |
| Proposal/Evaluating | Post-demo |
| MSA Sent/Review | Post-demo |
| Closed Won | Counted in actuals |

---

## How the Dashboard Works Interactively

The dashboard has **4 adjustable sliders** that instantly recalculate everything:

1. **Avg Deal Size** — changes how many deals are needed (default: $19,655)
2. **Demo → Won Rate** — changes how many demos are needed per close (default: 27.3%)
3. **Create → Demo Rate** — changes how many leads are needed per demo (default: 17.3%)
4. **Avg Cycle Time** — changes deadline zones on the timeline (default: 59 days)

There are also **preset buttons**: Conservative (defaults), Moderate (+20%), Aggressive (+30%), and Reset.

The user can also toggle between the two rate sets (Q1 2026 vs Q1-Q4 2025) to see how different historical periods change the projections.

---

## Key Context for This Business

- **Industry:** Behavioral health / substance abuse treatment EHR software
- **Sales motion:** Inbound + outbound, demo-based selling
- **Deal sizes:** Range from ~$5K to $1.2M ARR, median around $15-25K
- **Sales cycle:** Roughly 50-70 days from deal creation to close
- **Team:** 5 AEs with widely varying targets ($25K to $400K)
- **Zach Claussen and Hector Gomez** are new AEs with no historical data yet
- **Data freshness:** Cached from HubSpot CRM, synced daily at 2 AM
- **Date of this snapshot:** April 8, 2026
