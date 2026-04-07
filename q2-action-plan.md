# Q2 2026 Action Plan — Deliverables Package

---

## 1. SLACK MESSAGE: To HubSpot Admin Team (Lead Source Change)

Copy and paste this:

---

**Subject: New Lead Source Needed in HubSpot — "Co-Destiny Visit"**

Hey team, I need a new lead source value added to the `lead_source` (or `lead_source__sync_`) property in HubSpot. Here are the details:

**New Value:** `Co-Destiny Visit`
**Description:** Leads generated through in-person meetings with existing customers (co-destiny accounts). Humberto is leading these visits and booking demos from them. We need to track this as a distinct source so we can measure conversion rates separately from PPL, organic, etc.

**What needs to happen:**
1. Add "Co-Destiny Visit" as a new option to the lead source dropdown property in HubSpot
2. Confirm the internal value name (ideally `co_destiny_visit` or `Co-Destiny Visit` — whatever matches existing naming convention)
3. Let me know once it's live so we can start tagging deals immediately

**Timeline:** Need this done by EOD Wednesday at the latest. We're starting Q2 tracking and need this in place for any demos Humberto books this week.

Thanks!

---

## 2. SLACK MESSAGE: To the Sales Team (New Lead Source + Expectations)

Copy and paste this:

---

**Subject: New Lead Source Tracking + Q2 Demo Urgency**

Team, two things:

**1. New Lead Source: "Co-Destiny Visit"**
Starting immediately, any deal that comes from Humberto's in-person customer visits needs to be tagged with the lead source **"Co-Destiny Visit"** in HubSpot. This applies to any demo booked or deal created as a result of these account visits.

Why: We need to measure how this channel converts compared to PPL, organic, PPC, etc. so we can make smart decisions about where to invest time and resources.

**How to tag it:** When creating a new deal from one of these visits, set the Lead Source field to "Co-Destiny Visit." If the deal already exists, update the lead source.

**2. Q2 Demo Urgency — Hard Deadline**
Our data shows the median sales cycle is ~57 days from creation to close. That means:
- Deals created after **mid-May** are very unlikely to close within Q2
- Demos completed after **mid-May** face the same problem
- **April is the most critical month.** The majority of deals that will close in Q2 need to have their demos completed in the first 4-5 weeks of the quarter.

What this means for you: If you have prospects that are warm, push to get demos scheduled and completed **this week and next week**, not "sometime in April." Every week we wait costs us runway.

@Humberto specifically — the co-destiny demos need to be scheduled and completed in the first 3 weeks of April. If those demos happen in late May or June, they mathematically cannot close in Q2.

Let's make April count.

---

## 3. HOT TRACKER: Lagging & Leading Measures

For your 4DX / WIG framework:

**WIG (Wildly Important Goal):**
Close $925K in team new logo ARR by June 30, 2026.

**Lagging Measure:**
Cumulative closed-won ARR — tracked weekly on the Q2 Goal Tracker dashboard. Target pace: $71K/week cumulative.

**Leading Measure Option A (recommended):**
**Demos completed per week — target: 14/week (185 total / 13 weeks)**

Why this is the right leading measure:
- It's directly in the AEs' control (they can push to schedule and complete demos)
- It's predictive: 27.1% of demos convert to closed-won, so demo volume directly predicts revenue
- It's measurable weekly from HubSpot (demo_completed_entered_at timestamp)
- It captures urgency — if demos aren't happening, revenue won't follow 6-8 weeks later

**Leading Measure Option B (secondary):**
**Speed-to-demo: % of new leads that reach Demo Completed within 14 days of creation**

Why: This captures both the PPL response speed problem and the general urgency issue. Currently the median is 6 days but many leads take weeks. Targeting 80%+ of leads reaching demo within 14 days would compress the funnel.

**Scoreboard format for the HOT:**
| Week | Demos Completed (actual) | Demos Completed (target: 14) | Cumulative ARR (actual) | Cumulative ARR (target) |
|------|-------------------------|------------------------------|------------------------|------------------------|
| Wk 1 | _ | 14 | _ | $71K |
| Wk 2 | _ | 14 | _ | $142K |
| ... | | | | |

---

## 4. MOVES LIST — For Leadership Presentation

### Moves We Are Executing

**Move 1: Convert Existing Pipeline (~$544K post-demo after triage)**
- ~~Triage all post-demo deals this week (CSV sent to team)~~ DONE — team reviewed all deals
- ~~Status check Mindful Therapy ($1.2M)~~ DONE — will NOT close in Q2, removed from forecast
- ~~Status check New Season / Huntsville ($1M)~~ DONE — will NOT close in Q2, removed from forecast
- ~~Data integrity fix~~ DONE — sync job was leaving orphaned deals in stale active stages, inflating pipeline by ~$156K. Fixed: sync now refreshes orphaned deals from HubSpot on every run.
- Team is providing deal-by-deal likelihood assessments (in progress) — will produce a realistic weighted pipeline number
- Executive attention on remaining deals >$50K (Honey Lake $100K, Kemah Palms $91K, Karolyn Worrell $58K, CMETFL $50K)
- Enforce KPI: 100% of Proposal+ deals touched 2x/week with decision dates within 14 days
- Status: Triage complete, awaiting team likelihood data to finalize realistic pipeline forecast

**Move 2: Fix Lead Source Mix (Shift from PPL to Higher-Converting Channels)**
- PPL converts at 7.8% to demo; Organic at 72.7%; PPC at 25%; Events at 50%
- Recommendation: Cap PPL at 40% of lead budget, redirect to PPC and events
- Action: Conversation with Eric about organic/PPC budget reallocation
- Action: Identify May/June behavioral health conferences for attendance
- ~~"Co-Destiny Visit" lead source request submitted to HubSpot admin~~ DONE
- Status: Conversation needed with Eric + Marketing

**Move 3: Compress Sales Cycle (57 days toward 35-40 days)**
- CEO initiative: Pricing delivered on Demo 1, shared within 24 hours
- $150 gift card incentive for prospects who complete demo within 24-48 hours
- Mutual close plans for every post-demo deal
- Same-day demo booking for all inbound leads
- 5-minute first-touch rule for PPL (already enforced)
- Status: CEO initiative rolling out now

**Move 4: Coach AEs to Close (Bridge the Conversion Gap)**
- Chris: 15.5% demo-to-won (vs team avg 27.1%) — needs deal strategy coaching
- Jack: 11.7% create-to-demo — needs follow-up cadence review
- Weekly 1:1s with Chris and Jack (per KPI doc)
- Status: Ongoing

**Move 5: Establish Leading Measures (4DX / HOT Tracker)**
- Lagging: Cumulative closed-won ARR vs $71K/week pace
- Leading: Demos completed per week (target: 14/week)
- Urgency: April is make-or-break month — 50%+ of Q2 pipeline activity must happen in April
- Status: Adding to HOT this week

### Ideas for Leadership Discussion

**Idea A: Funnel Larger/Complex Deals to Adi**
- Adi's demo-to-won is 21.9% with an avg deal size of $27K+ historically
- For deals >$30K or multi-location accounts, having Adi run the sales process (or co-sell) could significantly improve close rates and deal sizes
- Considered vs. alternative of Adi staying purely in a management seat
- Recommendation: At minimum, Adi should be on every call for deals >$50K

**Idea B: AE Outbound Program**
- Currently all AEs appear to work inbound/PPL leads only
- Targeted outbound to behavioral health groups that recently raised funding, opened new locations, or are on legacy EHR systems costs nothing and produces larger deals
- Needs internal discussion: what are we doing with outbound?

**Idea C: Zach Claussen Collaboration Model**
- Zach works at BH Rev (sister company), handles RCM services
- Starting Q2, more collaboration on shared deals expected
- His $90K target is part of the team number but he has no data in our pipeline yet
- Need clarity: how will shared Opus/BH Rev deals be tracked and credited?

### Moves Considered and Ruled Out

**Raising prices across the board** — Ruled out because it would lengthen cycle times (prospects push back on unfamiliar pricing), which is the opposite of what we need. Cycle compression is more important than margin in Q2.

**Increasing deal size through bundling** — Valid concept (EHR+RCM bundled deals are 3-4x larger than EHR-only) but this is already a natural AE incentive. Not making it a formal initiative — AEs know to sell the full platform when the customer needs it.

**Eliminating PPL entirely** — Ruled out because (a) it provides volume that keeps AEs active, (b) some leads do convert, (c) abruptly cutting volume leaves AEs with empty calendars. Rebalancing is the right answer, not elimination.

**Replacing underperforming AEs** — Ruled out because recruiting and onboarding takes 3-6 months (no time in Q2), Chris IS improving (0 to $110K in two quarters), and Jack is very early in ramp.

### Risk Flag for Next Call

**Pricing-on-Demo-1 secondary effect:** Sharing pricing early compresses cycles, but only if value has been established first. If pricing hits before the prospect understands ROI, it creates price objections and ghosting. The demo structure needs to be: pain discovery (10 min) → tailored solution (20 min) → pricing in context of ROI (10 min). Not a feature tour followed by a price tag. Flag this with the CEO.

### Honest Expectation-Setting (Data-Backed)

| Scenario | Q2 ARR | Rationale |
|----------|--------|-----------|
| Conservative (pipeline-only) | $200-300K | ~$544K raw post-demo pipeline at historical win rates, no new lead gen impact. Mindful ($1.2M) and New Season ($1M) confirmed dead for Q2. |
| Realistic (all moves executed) | $400-550K | Pipeline converts + improved lead mix + cycle compression + AE coaching + new Q2 pipeline from April/May activity |
| Aggressive (everything clicks) | $600-700K | Realistic scenario + above-average close rates + deal size improvement + strong April pipeline generation |
| Best ever quarter to date | $300K | For context — Q2 2025, mostly Adi solo |

**Updated reality check:** With the two mega-deals ($2.2M) confirmed dead, the pipeline entering Q2 is materially smaller than originally projected. The $925K target now requires significant new pipeline generation in April/May, not just pipeline conversion. The team likelihood data (incoming) will sharpen these ranges further.

The 70% floor ($647K) triggers the $5,250 team bonus. Based on current data, this is an aggressive target that requires strong execution on all moves. The realistic range is $400-550K.

---

## 5. ASANA PROJECT: "Q2 2026 — Revenue Goal Execution"

### Section: Pipeline Triage (This Week)

**Task 1: Triage post-demo pipeline with team**
Description: Share the q2-pipeline-triage.csv with Chris, Jack, and the team. For each of the 33 post-demo deals ($2.9M total), classify as: (A) Closable in Q2, (B) Needs intervention, (C) Dead — kill it. Focus first on the mega-deals: Mindful Therapy ($1.2M, 411d), New Season ($1M, 119d). Schedule 30-min team session.
Due: April 4 (end of Week 1)

**Task 2: Status check on Mindful Therapy Group ($1.2M)**
Description: This deal has been in Proposal/Evaluating for 411 days. Call to determine: is there a real path to close in Q2? If yes, what's the blocker? If no, kill it and remove from pipeline. This single deal is 41% of the post-demo pipeline — its status changes everything.
Due: April 3

**Task 3: Status check on New Season / Huntsville ($1M)**
Description: Demo Completed stage, 119 days. Chris Garraffa owns this. What's the next step? Is there a decision-maker engaged? Is there a timeline? Get clarity this week.
Due: April 3

**Task 4: Implement mutual close plans for all Proposal+ deals**
Description: For every deal in Proposal/Evaluating or MSA Sent/Review, the AE sends a one-page document to the prospect: what was discussed, next steps, dates, who needs to be involved, decision date. No deal sits in Proposal without a documented close plan.
Due: April 7

### Section: Lead Source & Marketing (Week 1-2)

**Task 5: Add "Co-Destiny Visit" lead source to HubSpot**
Description: Send Slack message to HubSpot admin team requesting new lead source value. See message template in action plan doc. Need this live by Wednesday so Humberto can start tagging deals immediately.
Due: April 2

**Task 6: Notify team about new lead source + Q2 demo urgency**
Description: Send Slack message to sales team explaining the new lead source tracking and the hard timeline for getting demos completed in April. See message template in action plan doc.
Due: April 2

**Task 7: Meeting with Eric — lead source budget reallocation**
Description: Present the lead source conversion data: PPL 7.8% to demo vs PPC 25% vs Organic 72.7%. Discuss: (1) Can we increase organic/PPC spend? (2) What would that cost? (3) What conferences are we attending in May/June? (4) What does the PPL budget look like and can we redirect 30% to higher-converting channels?
Due: April 8

**Task 8: Identify May/June behavioral health conferences**
Description: Research and book 2-3 behavioral health industry conferences or events for May/June attendance. Events convert at 50% to demo and produce larger deal sizes. Check NAATP, OPEN MINDS, state association events.
Due: April 11

### Section: Sales Process (Week 1-2)

**Task 9: Add demo completion leading measure to HOT tracker**
Description: Add the leading measure to the sales HOT: "Demos completed per week — target 14/week." Set up weekly tracking. This is the team's primary leading indicator for Q2 revenue.
Due: April 4

**Task 10: Communicate to Humberto — April demo deadline**
Description: Humberto's co-destiny demos need to be scheduled and completed in the first 3 weeks of April. Make this explicit: demos happening in June cannot close in Q2. Set a specific target: X demos completed by April 21.
Due: April 2

**Task 11: Discuss outbound strategy with leadership**
Description: Currently all AEs work inbound/PPL. No structured outbound program exists. Discuss: should AEs be doing targeted outbound to behavioral health groups that raised funding, opened locations, or are on legacy systems? What would a lightweight outbound program look like? This is a zero-cost lead source.
Due: April 11

**Task 12: Clarify Zach Claussen collaboration model**
Description: Zach works at BH Rev (sister company). His $90K target is part of the team number but he has no data in our sales pipeline. Need clarity on: how will shared Opus/BH Rev deals be tracked? How will they be credited? When does active collaboration start?
Due: April 8

### Section: Leadership Alignment (Week 2)

**Task 13: Prepare Q2 data presentation for leadership**
Description: Compile the Q2 Goal Tracker dashboard data, the action plan, the moves list (executing + considered/ruled out), the scenario analysis ($400K conservative to $925K stretch), and the honest expectation-setting table into a presentation. Show the math, show the gap factors, show the plan.
Due: April 11

**Task 14: Schedule leadership meeting — Q2 expectations + plan**
Description: Book 45-60 min meeting with CEO/leadership to walk through: (1) Q1 retrospective data, (2) Q2 math (reverse-engineering formula), (3) per-AE gap analysis, (4) the 5 moves we're executing, (5) realistic scenario range, (6) what we need from them (marketing budget shift, outbound support, Zach clarity).
Due: April 9

**Task 15: Flag pricing-on-demo-1 risk in next leadership call**
Description: The CEO's initiative to share pricing on Demo 1 is good for cycle compression, but there's a secondary effect: if pricing is shared before value is established, it creates price objections and ghosting. Recommend demo structure: pain discovery (10 min) → tailored solution (20 min) → pricing in context of ROI (10 min). Flag this in the next call so the team executes it correctly.
Due: Next scheduled leadership call

### Section: Ongoing Weekly Cadence

**Task 16: Weekly pipeline review (recurring)**
Description: Every Friday, 30-min team review of all Proposal+ deals. For each deal: what happened this week? What's the next step? Is the decision date set? Are we touching it 2x/week? Kill any deal stale >14 days with no activity.
Due: Every Friday starting April 4

**Task 17: Weekly HOT scoreboard update (recurring)**
Description: Update the HOT tracker with: demos completed this week (leading), cumulative closed-won ARR (lagging). Compare against targets (14 demos/week, $71K/week cumulative). Share with team.
Due: Every Monday starting April 7
