# Humberto's Pipeline Goals — Q2 2026

## Summary

Humberto owns two new lead generation channels for Q2 2026: **Co-Destiny** referrals and **Channel Partner** referrals. His combined target is **50 leads** (25 per channel). This target is a pragmatic reduction from the mathematically-required ~220 leads — see the full analysis below.

---

## The Math: How We Got Here

### Step 1: Q2 Revenue Gap

| Metric | Value | Source |
|--------|-------|--------|
| Q2 ARR Target | $925,000 | Company KPI |
| Team-confirmed pipeline (raw) | $428,664 | AE triage exercise (15 deals) |
| Expected to actually close (× 27.3% demo→won) | ~$117,000 | Q1 2026 conversion rate applied |
| Marketing new leads expected (Q1 × 1.2) | 314 leads | 262 Q1 leads + 20% growth assumption |
| Marketing new revenue (314 × 17.3% × 27.3% × $19,655) | ~$290,000 | Q1 conversion rates applied |
| **Total expected revenue** | **~$407,000** | Confirmed pipeline + marketing new |
| **Revenue gap** | **~$518,000** | $925K − $407K |

### Step 2: Leads Required to Fill the Gap

Using a **45% create-to-demo rate** for Humberto's channels (warm referrals convert ~2.5× better than the blended 17.3%, which is dragged down by PPL at 8.3%):

| Metric | Value |
|--------|-------|
| New closes needed | $518K / $19,655 avg deal = **~27 deals** |
| New demos needed | 27 / 27.3% demo→won = **~99 demos** |
| New leads needed (at 45% create→demo) | 99 / 45% = **~220 leads** |
| Weekly pace (13 weeks) | ~17 leads/week |

### Step 3: Why 220 Is Unrealistic

220 leads from two brand-new channels run by one person is not achievable in Q2. For context:
- The entire PPL channel (our highest-volume source) produced 191 leads in Q1
- These are net-new channels with no established playbook yet
- Humberto is ramping both simultaneously

### Step 4: Pragmatic Target — 50 Leads

We set the target at **50 total leads** (25 Co-Destiny + 25 Channel Partner), acknowledging:

1. **This does NOT fully close the $518K gap.** At 45% create→demo and 27.3% demo→won, 50 leads produce ~6 closes → ~$118K, leaving ~$400K uncovered.
2. **The rest must come from:** AEs overperforming on existing pipeline, marketing exceeding the 20% lift assumption, or deal sizes coming in above the $19,655 average.
3. **50 is a stretch but achievable** first-quarter target for two new channels. It establishes baseline data we can use to set Q3 targets with real conversion rates.

---

## Target Breakdown

| Initiative | Owner | Lead Target | ARR Target | Weekly Pace | Lead Source (HubSpot) |
|-----------|-------|-------------|------------|-------------|-----------------------|
| Co-Destiny Referrals | Humberto | 25 | $118K | 2/wk | `Co-Destiny` |
| Channel Partner Referrals | Humberto | 25 | $118K | 2/wk | `Channel Partner` |
| **Combined** | **Humberto** | **50** | **$236K** | **~4/wk** | — |

**ARR target rationale:** 50 leads × 45% create→demo × 27.3% demo→won × $19,655 = ~$118K per channel. The combined $236K ARR target is aspirational — it assumes all leads convert at warm-referral rates.

---

## Key Assumptions

| Assumption | Value | Basis |
|-----------|-------|-------|
| Avg deal size | $19,655 | Q1 2026 closed-won average |
| Demo → Won rate | 27.3% | Q1 2026 (12 won / 44 demos) |
| Create → Demo rate (Humberto's channels) | 45% | Estimated — referral/event/organic channels convert at 50-67% in Q1 data; using 45% as conservative |
| Create → Demo rate (marketing/blended) | 17.3% | Q1 2026 blended (dragged down by PPL at 8.3%) |
| Marketing lead growth Q1→Q2 | +20% | Assumption — no specific marketing commitment |
| Q1 2026 marketing leads created | 262 | Database: PPL 191, PPC 22, Organic 13, Website 13, Event 10, List 5, Other 8 |
| Team-confirmed pipeline | $428,664 | AE triage exercise, 15 deals |
| Team-confirmed close rate | 27.3% | Applied demo→won rate (AE "likely to close" ≈ post-demo confidence) |

---

## Tracking

These initiatives are tracked in the **Q2 Command Center → Initiative Tracking** section. The system matches deals by `lead_source` field in HubSpot:

- Deals tagged `Co-Destiny` in HubSpot → counted toward Co-Destiny initiative
- Deals tagged `Channel Partner` in HubSpot → counted toward Channel Partner initiative

Progress is measured by:
1. **Lead count** — deals created with matching lead source
2. **ARR generated** — sum of deal amounts
3. **Weekly pace** — leads created per week vs. target pace
4. **Pace status** — ahead (>110% of expected), on pace (90-110%), behind (<90%)

---

## Important Context

- **Date of analysis:** April 9, 2026 (Week 2 of Q2)
- **Data freshness:** All numbers from Supabase, synced daily from HubSpot at 2 AM
- **Co-Destiny and Channel Partner are brand-new lead sources** — zero historical deals exist with these tags as of this analysis
- **The 50-lead target is ~23% of the mathematically-required 220** — this is a known, intentional gap accepted for Q2 as a ramp quarter for these channels

---

## Revision History

| Date | Change |
|------|--------|
| 2026-04-09 | Initial analysis and target setting |
