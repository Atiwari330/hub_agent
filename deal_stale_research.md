Please do up-to-date online research into SaaS companies, software companies. Maybe you can even get specific into healthcare industry SaaS sales. I don't know. Here's what I want to know: Let's imagine that what does the research show as how to define a stale deal in SaaS and software? Like, what does that mean? We sell behavioral health software, we sell electronic health record software and software in the behavioral health space. I'm the head of sales, and I want to know what is the best practice in terms of deals. What would be the definition of a stale deal? Is it a certain number of days open? Is it a certain number of days without response from the customer? What does the research say? If I had to go present a plan in front of a boardroom, what is the plan around stale deals that can be backed by up-to-date research specific to our field?

Below is a boardroom-defensible way to define and manage **stale deals** for SaaS—tuned for **healthcare / behavioral health EHR** where cycles are longer and stakeholders are multi-threaded.

## What “stale” means in SaaS (what the research converges on)

Across modern pipeline-management guidance, “stale” is **not just “old.”** It’s when an opportunity’s **normal progression stops**—typically visible as **excessive time-in-stage** and/or **lack of meaningful buyer engagement**. Deal-aging frameworks explicitly define the point of tracking age as finding where progression has stopped and an opportunity has become “stalled.” ([Resources Rework][1])

CRMs that implement “stale deal” features operationalize it the same way: define an expected “sales cycle” (or “staling age”), and flag deals that exceed it—because conversion likelihood drops as deals age past expectation. ([Freshsales][2])

**Key takeaway for your board plan:**
A **stale deal** is an opportunity that is **outside expected timing** *and* **lacks a validated next step** (or buyer engagement) that would justify keeping it in forecast/pipeline.

---

## Why healthcare SaaS needs a slightly different definition

Healthcare IT buying is often **committee-driven** and can be long (many orgs still report long cycles; some data suggests cycles are trending toward “within a year” for many decisions, but long-cycle segments persist). ([Health Launchpad][3])
And EHR purchases frequently involve formal procurement (RFI/RFP steps, evaluation, contract negotiation), which naturally creates “waiting periods” that can look like inactivity unless you instrument the milestones correctly. ([Massachusetts eHealth Institute][4])

**So in healthcare SaaS, “stale” should be defined relative to:**

1. **Stage-specific expected age** (because stages like Security/Legal/Procurement are inherently slower), and
2. **Evidence-based next milestone** (e.g., RFP release date, security questionnaire due date, exec sponsor meeting scheduled).

---

## Boardroom-ready definition (use this verbatim)

### Definition: “Stale Deal” (recommended)

A deal is **stale** when **either** of the following is true:

1. **Stage-age breach:** The deal has remained in its current pipeline stage longer than the **expected stage time** (based on your historical median for that stage and segment), *without completing the stage exit criteria.* (Deal-aging best practice: track total age and stage age specifically to detect stalled progression.) ([Resources Rework][1])

**OR**

2. **No verified next step / buyer silence:** There is **no documented, buyer-validated next milestone date** (meeting, procurement deadline, security review, contract redlines due, etc.) **within the next X days**, *or* there has been **no buyer response/interaction** for **X days** despite follow-up attempts. (Modern “deal slippage” research consistently flags follow-up and engagement as leading indicators of stall risk.) 

**Optional but highly practical third trigger**
3) **Close-date integrity breach:** The projected close date is **in the past**, or the close date has slipped **≥2 times** without a corresponding change in verified milestones (a classic “pipeline hygiene” failure mode called out in pipeline-management guidance). ([Outreach][5])

---

## The thresholds: what numbers to use (best-practice approach)

Instead of one universal “90 days open,” best practice is **segment + stage-based**.

### 1) Build “Expected Days in Stage” by segment

Do this from your own HubSpot history (best defensibility), then use external benchmarks only as supporting context.

**Rule of thumb that boards accept well:**

* Expected stage time = **median days in stage** for similar deals (segment by ACV/provider size, sales motion, inbound vs outbound).
* Stale threshold = **> 1.5× median** (yellow) and **> 2.0× median** (red).

This matches how teams diagnose “stage bloating / deal velocity problems” operationally: the issue is *time spent stuck in stage* rather than total age alone. ([mentorgroup.com][6])

### 2) Add an “inactivity SLA” (buyer-facing)

Because you’re selling an EHR in behavioral health, you’ll have legitimate “procurement waiting” windows—so you don’t want a simplistic “no activity = stale” unless you define what counts as *meaningful* activity.

**Recommended inactivity SLAs (starting point):**

* **Early stages (Lead → Discovery/Demo):** stale if **no buyer response/interaction in 7 business days**
* **Mid stages (Evaluation/Stakeholders/Security):** stale if **no buyer response/interaction in 10 business days**
* **Late stages (Legal/Final negotiation):** stale if **no buyer response/interaction in 15 business days**

Support this with a credible “why responsiveness matters” data point: Gong reports that **32% of the time reps don’t follow up within 24 hours**, and positions timely engagement as a difference-maker in winning vs losing. 
(You can frame this as: *we’re implementing response-time and follow-up discipline as a stall-prevention control.*)

### 3) Add “next step required” as a hard rule

Healthcare deals can be quiet **but still healthy** if there’s a dated milestone (RFP timeline, security due date, committee meeting, etc.). Procurement toolkits emphasize structured phases and due diligence steps—those become your milestone taxonomy. ([Massachusetts eHealth Institute][4])

---

## The plan you can present to a board: “Stale Deal Governance System”

### A. Instrumentation (Week 1–2)

1. **Capture stage timestamps + stage age** (HubSpot supports tracking time in stage; many pipeline-hygiene playbooks recommend this explicitly). ([Portant][7])
2. Add required fields per stage (exit criteria), e.g.:

   * Decision process known (committee list)
   * Procurement path (direct vs RFP)
   * Security steps (BAA, SOC2 review, SSO)
   * **Mutual Action Plan milestone date**
3. Define “meaningful activity” = buyer reply, meeting held, security/procurement deliverable exchanged (not just internal notes).

### B. Definition + Flagging (Week 2–3)

Create 3 automated flags:

* **Yellow (At Risk):** stage age > 1.5× median OR inactivity SLA breached once
* **Red (Stale):** stage age > 2× median OR inactivity SLA breached twice OR close date in past
* **Black (Ghost):** no engagement + no next step + no verified pain/champion (remove from forecast; requalify)

(“Ghost pipeline vs stale deal” distinctions are commonly used in pipeline-health frameworks to prevent forecast inflation.) ([dowidth.com][8])

### C. Operating cadence (ongoing)

* **Weekly “Stale Deal Review” (30 min):**

  * Red deals must have one of three dispositions:

    1. **Revive** (exec intervention + MAP reset)
    2. **Recycle** (nurture sequence, remove from forecast)
    3. **Close Lost** (reason code; clean pipeline)
* **Monthly board metric pack:**

  * % of pipeline flagged stale (by stage)
  * Median stage age vs last quarter
  * Close-date slippage count
  * Forecast accuracy impact (before/after cleanup)

This aligns with mainstream pipeline-management guidance emphasizing ongoing “pipeline hygiene,” removing stale deals, and tightening forecast accuracy. ([Outreach][5])

### D. Intervention playbook (what you *do* when stale)

For behavioral health EHR, the fastest “unstall” moves tend to be:

1. **Multi-thread the committee** (clinical + ops + billing/RCM + compliance) and confirm the decision path
2. **Convert “interest” into a dated procurement artifact**

   * security checklist due date
   * reference call scheduled
   * ROI/business case review meeting
3. **Exec sponsor escalation** when the blocker is prioritization, not product fit

### E. Policy: what counts as “kept alive”

A stale deal can stay open **only if** it has:

* a dated next milestone (MAP), and
* a clear owner on the buyer side, and
* a documented reason for time (procurement/security/calendar), consistent with how EHR procurement typically runs. ([Massachusetts eHealth Institute][4])

---

## A simple definition you can put on a slide

> **Stale = “No validated next step + outside expected stage timing.”**
> We flag staleness using **(1) time-in-stage vs historical median**, **(2) buyer inactivity SLAs**, and **(3) close-date integrity**—then run a weekly disposition cadence to revive, recycle, or close-out.

If you want, tell me your **current HubSpot stages** and (roughly) your **typical ACV bands** (e.g., <$10k, $10–25k, $25k+). I’ll translate the framework above into exact **stage-by-stage stale thresholds** and **required exit criteria** that match your pipeline.

[1]: https://resources.rework.com/libraries/pipeline-management/deal-aging-management?utm_source=chatgpt.com "\"Deal Aging Management: Identifying and Addressing Stalled ..."
[2]: https://crmsupport.freshworks.com/support/solutions/articles/50000002157-what-are-stale-deals-how-do-they-work-?utm_source=chatgpt.com "Support : Freshworks - Freshsales"
[3]: https://healthlaunchpad.com/the-evolving-healthcare-it-buyer-journey/?utm_source=chatgpt.com "The Evolving Healthcare IT Buyer Journey - healthlaunchpad.com"
[4]: https://mehi.masstech.org/sites/default/files/2022-06/MeHI_toolkit_full_ebook_with_arrows_links3.pdf?utm_source=chatgpt.com "EHR Planning and Procurement Toolkit - MeHI"
[5]: https://www.outreach.io/resources/blog/sales-pipeline-management-best-practices?utm_source=chatgpt.com "Sales pipeline management best practices (2026 Guide)"
[6]: https://www.mentorgroup.com/sales-training-research/unhealthy-deal-velocity-patterns?utm_source=chatgpt.com "How to Spot and Diagnose Unhealthy Deal Velocity Patterns"
[7]: https://www.portant.co/post/how-to-bring-structure-to-sales-pipelines-using-deal-stage-progression-triggers-in-hubspot?utm_source=chatgpt.com "How to Bring Structure to Sales Pipelines Using Deal Stage Progression ..."
[8]: https://dowidth.com/sales/stale-deal-vs-ghost-pipeline?utm_source=chatgpt.com "Ghost Pipeline vs Stale Deal in Sales - dowidth.com"
