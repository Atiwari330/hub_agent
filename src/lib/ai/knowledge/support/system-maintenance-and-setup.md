# System Maintenance & Setup (RCM)

## Overview

One-time and infrequent configuration tasks in the Opus RCM / Imagine system. Covers locations, providers, procedures, diagnosis codes, financial classes, fee schedules, insurance carriers, roles, scheduled jobs, and data sets/entities.

System Maintenance is accessed from the left-hand navigation in Opus RCM. It mirrors the **Implementation Tracker** (the guided setup wizard shown to new clients), but remains accessible permanently after setup is complete. Items not in the Implementation Tracker are considered optional configuration.

- **Required fields** are the minimum needed to successfully bill a claim. The system will indicate required vs. optional on each screen.
- Items in the Implementation Tracker are what we **need**. Everything else in System Maintenance is **optional** enhancement.
- System Maintenance also includes a **Conversions** section (mapping EHR codes to RCM codes) and an **Institutional Billing** section (only visible when institutional billing is enabled in data set settings).
- Every section in System Maintenance supports **bulk upload via CSV or Excel template**. Upload templates are available from within each screen.
- Items cannot be deleted (RCM has no delete concept for configured data); instead they can be **inactivated**.

---

## Locations

Locations represent physical office/clinic sites where services are rendered. A location must exist before providers can be configured (relational dependency: providers link to locations).

### Required Fields
- **Location code** (short user-defined identifier — see below)
- **Name**
- **Address**

### Location Code
- User-defined short string. No system-enforced format.
- Best practice: make it intuitive and human-readable. Examples: `CLT` for Charlotte, `MON` for Monroe, `AVW` for A Village Wellness.
- ⚠️ Avoid random strings like `7724AlphaJohnQ` — they confuse billers and reports.
- **Location codes are not synced from the EHR.** They are created independently in Opus RCM. The EHR team does not assign them. Laura's question about this in Session 1 confirmed: just make them up, but make them sensible.

### EHR ↔ RCM Relationship for Locations
- Locations in Opus RCM do **not** automatically sync from the EHR. They are set up separately and then linked back to the EHR environment via the Conversions module.
- Multiple EHR locations can map to a single RCM location (common for clients with many EHR sub-sites but a single billing location).
- 🔧 EHR The linkage between EHR locations and RCM locations is managed through the Conversions screen (see **Conversions** section below) and is part of the initial implementation configuration coordinated with Marilyn/Hector's team.

### Institutional Billing Locations
- Institutional billing adds additional location-related fields (frequency, facility codes, occurrence codes). These only appear if institutional billing is enabled at the data set level.

### Upload
- Locations can be bulk-uploaded via CSV or Excel template. Template available within the Locations upload screen.

---

## Providers

Providers must be set up before procedures, fee schedules, and many other items can be fully configured (relational dependency).

### Required Fields
- **Provider code** (user-defined short identifier)
- **Last name**
- **NPI** (National Provider Identifier, 10-digit)
- **Taxonomy code**

### Provider Code
- Same conventions as location code: keep it short and intuitive.
- Common pattern: first initial + last initial (e.g., `BT` for Ben Todys). For larger groups: first initial + middle initial + last initial.
- Avoid long or meaningless codes — billers see these codes on patient accounts and need to know at a glance who they refer to.

### NPI
- 10-digit National Provider Identifier. Public information — can be looked up at [NPPES](https://nppes.cms.hhs.gov/).
- 🎫 **Missing NPI is one of the most common Pre-Submission Errors.** A claim will be blocked from going out if the attending or referring provider NPI is absent.
- As soon as a missing NPI is added to the provider in System Maintenance, the system automatically re-evaluates all held claims for that provider and releases them from the Pre-Submission Errors queue.

### Taxonomy
- Required on provider setup. Describes the provider's specialty/credential type.
- ⚠️ **Critical:** The taxonomy in Opus RCM must exactly match the taxonomy set in the Opus EHR for the same provider. If they differ, **the EHR will override the RCM value on the next sync**, which will cause billing errors.
- 🔧 EHR Taxonomy mismatches are an EHR-side configuration issue. The EHR onboarding template must capture taxonomy and it must match what is entered in RCM. This is a known common problem with legacy migrations (e.g., clients migrating from Practice Suite who never had taxonomy set in EHR).

### Supervisor
- If a provider is not fully licensed, a **default supervising provider** can be set. This is a state licensure requirement, not always a payer requirement.

### Provider Syncing
- Providers **do sync** between EHR and RCM (one of only a few items that do). The EHR is the source of truth for provider demographic fields that overlap.
- Changes made in RCM are sent back to EHR, but whether EHR accepts/applies them is EHR team territory.

### Link Providers (Conversions)
- If an EHR provider doesn't auto-match to an RCM provider, they must be manually linked via the **Conversions → Providers** section. Default auto-matching attempts to link by NPI.

### Upload
- Providers can be bulk-uploaded via CSV or Excel template.

### Other IDs
- Providers can have additional IDs (Medicaid provider ID, commercial IDs, etc.) added beyond NPI.

---

## Procedures

Procedure codes (CPT/HCPCS) are the billable services. Procedures must exist in Opus RCM for visits to be processed.

### Required Fields
- **Procedure code** (CPT or HCPCS code)
- **Description**

### Optional but Important Fields
- **Default fee** — used as the billed charge amount if no fee schedule override exists
- **Default modifier** — modifier automatically applied to this procedure on every claim unless overridden
- **Insurance codes** — the code sent to specific payers if it differs from the CPT code. One procedure can have multiple insurance codes (code 1 = primary/default, codes 2–5 = alternatives). Rules or payer logic determine which insurance code is used.
- **NOC flag** — "Not Otherwise Classified." Checking this opens a comment/narrative box on the claim for the payer to understand what the unlisted procedure was.

### Procedure Code Best Practices
- ⚠️ **Do not use special characters** in procedure codes. Special characters (commas, hyphens, etc.) are reserved characters in the electronic claim file (ANSI 837) and can corrupt outgoing claims. Use alphanumeric only.
- Characters after a comma or hyphen may be truncated/ignored in code matching logic.

### EHR ↔ RCM Relationship for Procedures
- 🎫 Procedures from EHR that do not match an RCM procedure code land in **Procedure Import Errors** queue.
- Procedures should be set up identically in both EHR and RCM wherever possible. Conversions exist as a workaround but are not the preferred long-term approach.
- 🔧 EHR If a procedure code syncs from EHR but the RCM has no matching code, the visit will be held in Procedure Import Errors until the conversion is mapped or the procedure is added to RCM.

### Upload
- Procedures can be bulk-uploaded via CSV or Excel template.
- Alyssa (BH Rev) maintains behavioral-health-specific procedure code templates to standardize initial setup.

---

## Diagnosis Codes

ICD-10 diagnosis codes used on claims. Up to 4 diagnosis codes can be attached to a single procedure line on a claim.

### Auto-Matching
- Diagnosis codes **auto-match** between EHR and RCM by exact code string. No manual mapping needed unless the exact code does not exist in RCM.
- If EHR sends a diagnosis code that has no match in RCM, it appears in the **Conversions → Diagnosis Codes** section. The visit will be held in **Procedure Import Errors** until resolved.
- Diagnosis code auto-matching means you will rarely need to manually manage this section once the standard code set is loaded.

### ICD-10 Compliance
- ⚠️ All codes must be **coded to the highest degree of specificity**. Non-specific/non-billable codes (e.g., `F32.8`) will result in clearinghouse or payer rejection with error "must be coded to highest specificity." Use `F32.81` or `F32.89` instead.
- 🎫 This is a common rejection source. Check [ICD10Data.com](https://www.icd10data.com/) — codes shown in red are non-billable.
- ICD-9 codes are no longer accepted by Medicare or most payers. Do not load ICD-9 codes.
- ICD-11 does not yet exist in practice (transition has not occurred as of training date).

### Upload
- Diagnosis codes can be bulk-uploaded via CSV or Excel template.
- BH Rev maintains a standard behavioral health diagnosis code template. When EHR and RCM use the same template, conversion mapping issues disappear.

---

## Financial Classes

Financial classes are user-defined categories that insurance carriers roll into. They control patient billing behavior: statement cycles, collections, write-offs.

### Relationship to Insurance Carriers
- Insurance carriers are assigned a **default financial class**.
- Example: Blue Cross, Aetna, Cigna, UHC → all roll into "Commercial Insurance" financial class.
- Medicaid → its own financial class (typically no patient statements).
- Self Pay → its own financial class.

### What Financial Class Controls
- **Send statements**: yes/no — Medicaid usually "no."
- **Statement cycle**: how often statements are generated (e.g., every 30 days).
- **Statement minimum**: minimum balance required before a statement is sent (e.g., $5.00 — avoid sending a $0.50 statement that costs more to print than to collect).
- **Automate collections**: whether balances auto-route to collections queue after a set number of statements.
- **Automate write-off for small balances**: automatically write off balances below a threshold.
- **Delinquency codes**: 0 = new/first statement, 1 = 30 days, 2 = 60 days, 3 = 90 days. Advancing these codes requires the **Generate Statements** scheduled job to run.

### Important Behaviors
- Financial class is **not synced from EHR**. It lives only in Opus RCM and must be configured manually.
- Financial class defaults from the insurance carrier assigned to a visit, but can be overridden at the visit level.
- ⚠️ **Collections automation requires the "Generate Statements" scheduled job to be running.** If this job is not scheduled, delinquency codes never advance, collections never trigger, and the client will never see items in the Collections queue automatically.
- Client-defined. Some clinics have one financial class for everything; large groups may have many.

---

## Fee Schedules

Fee schedules define the contracted/expected payment amounts per procedure per payer. They drive underpayment detection.

### Structure
- One fee schedule can be assigned to one or multiple insurance carriers.
- A fee schedule contains one line item per procedure code with an **expected/allowed amount**.
- Fee schedules can be **uploaded via CSV**, **copied from existing** schedules, or manually entered.
- Amounts can be updated by percentage (e.g., "reduce all by 3%" if a payer cuts rates).

### Fee Schedule Types
- **Procedure fee schedule**: what the provider charges.
- **Payment fee schedule**: what the provider expects to receive.

### Impact on Queues and Transactions
- The fee schedule drives the **allowed amount** field in transaction/ERA posting.
- When a payment is received that is less than the fee schedule amount, the visit is flagged in the **Underpaid Procedures** queue.
- If no fee schedule exists for a payer/procedure, billing still works — but the underpaid queue will not populate and allowed amounts will not auto-fill.

### Out-of-Network Providers
- Providers not contracted with a payer have no fee schedule for that payer. Nothing breaks; the system simply cannot detect underpayment. This is expected behavior.

### Common Scenarios
- A client in North Carolina may need to update their Medicaid fee schedule after periodic state rate reductions.
- Medicare sequestration (a federally mandated 2% payment reduction) is a line-item deduction that does not appear in the fee schedule allowable — some providers mark these as underpaid via EOB code checkbox.

---

## Insurance Carriers

The most configuration-dense section of System Maintenance. Each carrier defines how claims are transmitted, what eligibility checks look like, and how payments are processed.

### Key Fields

#### Insurance Code
- User-defined short code for the carrier (e.g., `BCBS-NC` for Blue Cross Blue Shield of North Carolina). Same conventions as location/provider codes: keep it intuitive.

#### Payer ID
- The electronic payer ID used by Phicure (clearinghouse) to route claims.
- **Special keyword — `paper`:** Enter `paper` as the Payer ID to force Phicure to print and mail the claim on the client's behalf. Client does not need to print it themselves.
- **Special keyword — `error`:** Enter `error` as the Payer ID to instruct Phicure to completely skip/ignore this claim. Used for payers that don't accept electronic claims (e.g., certain workers' comp, auto insurance, church/group billing arrangements).
- When claim type is set to paper, the Payer ID field is not required.

#### Claim Type
- **Professional Electronic** — sends an ANSI 837P file electronically via Phicure.
- **Professional Paper** — Opus RCM prints the CMS-1500 form. Client must physically mail it.
- **Professional Electronic with Paper** — Phicure prints and mails on the client's behalf (requires `paper` keyword in Payer ID).
- **Institutional Electronic** — sends an ANSI 837I file electronically. No institutional paper option.
- ⚠️ "Professional paper" and "Professional electronic with paper" are not the same. Clients often confuse them.

#### Secondary Claim Type
- Some payers require a different claim type when billed secondary (e.g., Medicaid as secondary may require paper in certain states).
- Can be set at the carrier level so it applies automatically when the carrier is billed secondary.

#### Carrier Type
- Tells the payer what type of plan it is: Blues, Commercial, Medicaid, Medicare, Self Pay, Group Billing.
- **Group Billing**: used when billing an entity (company, government agency) rather than an insurance company. Does not generate an 837 claim — generates a **Group Billing Report** (Excel). Useful for on-site employer programs, blood drives, etc.

#### HCFA Configuration
- Found under each carrier's edit screen.
- Sets global defaults for how claims are built for this specific carrier without needing a rule.
- When troubleshooting unexpected claim behavior, **check HCFA config at the carrier level first, then check Rules.**

#### Hold Billing
- Checking "Hold Billing" at the carrier level puts all current and future claims for this carrier on hold globally.
- 🎫 Common reason: waiting for credentialing/enrollment to complete. Common during Change Healthcare-type outages.
- ⚠️ When Hold Billing is unchecked at the carrier level, all held claims for that carrier immediately move to the Outgoing Insurance Claims queue (if no other errors exist).

#### Exclude from Eligibility
- Prevents eligibility requests from being sent to this carrier.
- Use for: payers that don't return electronic eligibility (e.g., Department of Corrections, certain state payers), workers' comp, cost-sensitive clients who only want eligibility on certain populations.

#### Fee Schedule
- A fee schedule and payment fee schedule can be assigned at the carrier level.

#### Place of Service Crosswalk
- Maps one place of service code to another on outbound claims.
- Example: NC Medicaid does not allow POS 10 (telehealth in patient's home) — must bill POS 11 (office) with a telehealth modifier. Set up: POS 10 → POS 11, then add a rule to append the correct modifier.

#### Auto Adjustments / Group Number / Policy Number Required
- Carrier-level toggles for common payer-specific requirements.

### Deactivating a Carrier
- Deactivating a carrier prevents new visits from being assigned to it.
- Existing visits already using that carrier are unaffected.
- If EHR sends a visit for an inactive carrier, the client will see a **sync error**.
- Deactivated insurance carriers do not remove data from existing patient accounts.

### Conversions for Carriers
- 🎫 If a visit arrives from EHR with an insurance carrier that doesn't match any carrier in RCM, the carrier field on the visit will be blank. This is a Conversions mapping issue.
- Characters after a comma or hyphen in an insurance code may be ignored during matching — carriers with similar codes but different suffixes can cause unpredictable matching.

---

## Roles & Users

### Role Architecture
- Roles in Opus RCM are **cumulative/additive**, not exclusive. A single user can hold multiple roles simultaneously (e.g., charge posting + payment posting + refund).
- This differs from many systems where a user is assigned a single named role.
- Build roles by combining permission components (charge posting, payment posting, refund processing, etc.) rather than assigning a single all-or-nothing role.

### User Visibility
- Imagine internal users (with `imagineteam.com` email addresses) are hidden from client-facing views.
- Opus internal/support users (with `opusbehavioral.com` email addresses) are in process of being hidden from client views as well, to avoid cluttering client user lists.
- Clients logging in see only their own organization's users.

### Authentication
- Uses **Microsoft Azure authentication (Microsoft Intra / Entra ID)**.
- One username and password grants access to all client environments the user has been granted access to — no separate credentials per client URL.
- New users must click **Forgot Password** to set their initial password. Passwords are not set by admins.

### User URLs
- Every client has their own unique URL: `[clientname].opusrcm.imagineparagraph.com`
- The sandbox/internal environment (`sandbox.opusrcm.imagineparagraph.com` or similar) is shared and connected to a test EHR environment — not a production client environment.
- Do not share sandbox URLs with clients without restricting their data set access.

### Audit Logs
- Full user activity audit logs exist at the backend level and are accessible to Imagine support team only.
- 🔍 Client-visible account-level notes capture most user actions (charge posted, claim submitted, visit edited, etc.) with username and timestamp.
- ⚠️ Notes cannot be deleted. Sensitive or erroneous notes added by Opus staff can only be removed via direct Imagine database manipulation (a rare and deliberate action). Notes added by clients to patient accounts are permanent.
- 🎫 Support implication: If a client reports a note was added in error, tell them it cannot be self-deleted. For Opus staff notes, escalate to Imagine.

### Permissions and Reports
- ⚠️ Deanna confirmed: if a user's System Maintenance access is turned off in their role, **they will be unable to select certain report filter fields** (e.g., the "as of date" in the ATB/AR report). This is a known permission dependency. If a user reports a field is grayed out in a report, check their role/permissions first before assuming a bug.

---

## Scheduled Jobs

Scheduled Jobs are the automation engine of Opus RCM. This is the primary differentiator from competing products. Jobs run on configurable schedules and eliminate the need for manual daily intervention for most routine tasks.

### How to Access
System Maintenance → Scheduled Jobs. Or Settings → Scheduled Jobs.

### Key Jobs and Their Purpose

| Job | Purpose |
|---|---|
| **Send Claims** | Empties the Outgoing Insurance Claims queue and transmits to Phicure |
| **Fetch Remittances** | Retrieves ERA (Electronic Remittance Advice) files from Phicure |
| **Generate Eligibility Requests** | Sends 270 eligibility inquiry transactions to Phicure |
| **Fetch Eligibility Responses** | Retrieves 271 eligibility response files from Phicure |
| **Generate Statements** | Creates patient statements and advances delinquency codes |
| **Process Automated Collections** | Routes eligible patient balances to collections export |
| **Receive Imagine Pay** | Imports patient payments from the Imagine Pay portal |
| **Archive Accounts** | Moves zero-balance inactive accounts to archived state |
| **Generate Dashboards** | Refreshes internal dashboard data (Imagine-managed, not client-visible) |

### EHR ↔ RCM Sync and Scheduled Jobs
- **The EHR↔RCM connection runs outside of scheduled jobs.** Patients and visits sync in real time (≈55ms for patients) and are not gated by any scheduled job. The sync button in EHR billing tab sends immediately.
- Scheduled jobs are for batch operations (claims transmission, ERA retrieval, eligibility, statements) — not for the live EHR data pipe.

### Scheduling Options
- Daily, weekly, monthly, or custom interval (e.g., every 4 hours).
- One-time execution: set frequency = 1. The job runs once at the specified time and does not repeat.
- ⚠️ There is **no manual "Send Now" button** for claims. If a client needs to send claims outside their schedule, they must create a one-time job execution.
- Best practice for claims: schedule send once daily (e.g., 4pm) or twice daily (5am + 5pm).
- Best practice for eligibility: send eligibility requests at night, fetch responses next morning (most payers return responses within 24 hours).

### Job Assignment and Failure Notifications
- Each job is assigned to a user. If the job fails, that assigned user receives a **bell notification** in Opus RCM.
- 🎫 If a client reports not receiving eligibility results: check (1) is Generate Eligibility Requests job scheduled and active? (2) Is Fetch Eligibility Responses job scheduled and active? Both are required. One without the other produces no results.

### Collections and the Generate Statements Job
- ⚠️ Automated collections **will never trigger** if the Generate Statements job is not running. This job is what advances delinquency codes (0→1→2→3). Without it, accounts never age and never reach the collections threshold.
- 🎫 Common support ticket: "Collections aren't working." First question: is Generate Statements job scheduled and running?

### Scheduled Job vs. One-Time Config
- The Implementation Tracker guides initial setup, but all items can be revisited and changed in System Maintenance at any time.
- Scheduled jobs are client-configurable. Opus/Imagine typically set up initial jobs during onboarding. Clients can edit, add, or remove jobs at any time.
- Deanna's team sets up initial job configuration during onboarding calls and records client preferences. If a client claims jobs were never set up: check the onboarding call notes before assuming it was missed.

---

## Data Sets & Entities

### What is a Data Set?
A data set (sometimes called an "entity" or shown as a dropdown in the upper left of the Opus RCM interface) represents a **fully segregated grouping of billing data** within a single client URL.

- Different data sets have different patients, providers, locations, insurance carriers, reporting, and financial data. They are completely isolated from each other.
- One data set = one legal entity with a distinct tax ID (EIN).
- The single-client URL (e.g., `acmetherapy.opusrcm.imagineparagraph.com`) stays the same regardless of how many data sets exist under it.

### When Multiple Data Sets Are Used
- When a client has multiple legal entities with different Tax IDs (EINs) that require separate billing, separate reporting, or separate patients.
- Example: a behavioral health network with an adult services entity and a teen services entity under different EINs.
- Example: InnerHealth has multiple tax IDs → multiple data sets with a dropdown selector.
- Example: True North has one tax ID → one data set, no dropdown.

### When Multiple Data Sets Are NOT Needed
- A client with multiple physical locations but one tax ID does NOT need separate data sets. Use **Locations** in System Maintenance instead.
- If patients can be seen at any of the client's locations by any of the client's providers, one data set is almost always correct.

### Adding Data Sets
- New data sets are added via **Data Set Management** in System Maintenance.
- 🔧 Linking a new data set to the correct EHR environment is coordination-level work involving Marilyn and Hector's team. It is not self-service.

### Institutional Billing
- Institutional billing features in System Maintenance (UB-04 setup, institutional carrier config, etc.) are **only visible** when institutional billing is enabled in the data set settings. If a client reports not seeing institutional billing options, check the data set setting first.

---

## Conversions

Conversions are the code-mapping layer between the EHR and Opus RCM. When the EHR sends a code that doesn't exactly match an RCM code, Conversions provide a manual lookup/linkage.

### Types of Conversions
- **Procedures** — maps EHR procedure codes to RCM procedure codes
- **Diagnosis Codes** — maps EHR diagnosis codes to RCM diagnosis codes (auto-matches by default; only appears here if unmatched)
- **Providers** — maps EHR provider identifiers to RCM provider records
- **Locations** — maps EHR location identifiers to RCM locations
- **Insurance Carriers** — maps EHR carrier codes to RCM carrier records

### How Auto-Matching Works
- Diagnosis codes: exact string match. If the EHR sends `F32.81` and RCM has `F32.81`, it links automatically with no user action.
- Providers: attempts to match on NPI by default.
- Insurance carriers: matches on the carrier code string. Characters after a comma or hyphen may be ignored — can cause unintended matches when codes share a prefix.
- ⚠️ When multiple codes in RCM share the same prefix (before a comma or hyphen), the system may grab the **first one found**, which is non-deterministic. This is a known limitation.

### Common Conversion Problems
- 🎫 **Insurance carrier blank on a visit**: almost always a carrier conversion miss. EHR sent a carrier identifier that has no RCM match.
- 🎫 **Diagnosis code missing from visit**: EHR sent a code that doesn't exist in RCM → goes to Conversions → visit drops to Procedure Import Errors.
- 🎫 **Wrong procedure code on claim**: could be a conversion that maps to the wrong code.

### Workflow Recommendation
- ⚠️ **Best practice: do not rely on Conversions as a permanent solution.** The preferred approach is to ensure EHR and RCM are set up identically so codes match without needing Conversions. Use Conversions as a one-time fix, not an ongoing workaround.
- For behavioral health clients with limited procedure code sets, Alyssa's standardized templates minimize conversion mismatches at go-live.
- Use special characters? Don't. They break matching. Letters and numbers only in all codes.

### Resolving Conversion Issues
- Navigate to System Maintenance → Conversions → [type].
- Items in the list are codes sent from EHR that have no match. Click edit to link them to the correct RCM item.
- Once linked, all visits previously blocked by that conversion miss will **automatically re-evaluate** and process forward — no manual re-submission needed per visit.

---

## Common Issues in Support Tickets

### "I can't find a patient / patient is missing from accounts"
1. **Check Demographic Import Errors queue first.** If the patient synced from EHR with missing required fields (address, insurance, etc.), they will be held here and will NOT appear in the Accounts list.
2. If patient exists in Accounts but visits are missing: check **Charge Central** (if enabled) — visits not reviewed in Charge Central do not appear on patient accounts.
3. Check **Procedure Import Errors** — visits with procedure-level errors are also held and not visible on the account.
4. Check **File Import** (under account History → Audit History) for the raw EHR API payload. This is the source of truth for what was sent. If the patient was never sent from EHR, it won't be in RCM.
5. 🔍 If the patient should have synced but doesn't appear anywhere: check with Imagine support — there may have been a burst-payload issue where RCM didn't acknowledge receipt and EHR stopped retrying.
- **Note:** Missing patient = missing in Demographic Import Errors OR never sent from EHR. These are the only two explanations.

### "I can't add a provider"
- Verify all required fields are present: last name, NPI, taxonomy.
- If taxonomy is present in EHR but not in RCM (or mismatched): the EHR will override whatever is in RCM on next sync. Fix the taxonomy in EHR first, then update RCM to match.
- NPI can be looked up at [NPPES](https://nppes.cms.hhs.gov/) — it is public record.
- Check permissions: does the user have system maintenance access in their role?

### "Claims aren't going out"
1. **Outgoing Insurance Claims queue** — is it populated? If yes, it's just waiting for the scheduled Send Claims job to run. Check when the next execution is.
2. **Pre-Submission Errors queue** — visits here are blocked. Fix the listed errors (typically missing NPI, missing diagnosis, invalid procedure code). Once fixed, claims automatically re-queue.
3. **Insurance Visits on Hold** — carrier-level or visit-level hold is active. Check carrier's "Hold Billing" in System Maintenance and visit-level hold flags.
4. **Charge Central** — if enabled, visits must be reviewed and posted here before they appear on patient accounts and proceed to claims.
5. **Rules** — a hold rule may be routing visits to a custom queue. Check Settings → Rule Builder.
6. If the scheduled Send Claims job is paused or not configured: create or re-enable the job.

### "My scheduled job isn't running"
1. Navigate to System Maintenance → Scheduled Jobs. Find the job.
2. Check: Is it set to Active or Paused?
3. Check the "Next Execution" time — is it set to the right time zone and schedule?
4. Check the assigned user's bell notifications for failure messages.
5. If the job shows as Active but claims/remits aren't arriving: escalate to Imagine. Could be a backend/clearinghouse issue.
- 🔍 For persistent job failures, Imagine can investigate clearinghouse logs via Phicure's portal.

### "Visit shows the wrong insurance / provider / diagnosis"
1. Go to patient account → History → **Audit History**. Download the raw EHR payload for the visit. This is what the EHR actually sent — the ground truth.
2. If the EHR payload is wrong → 🔧 EHR issue. Hector's team owns the fix.
3. If the EHR payload is correct but RCM displays something different → check **Conversions** (maybe the code is being remapped) and check **Rules** (a rule may be altering the field at billing time).
4. Rules only apply at **billing time** — they do not change the visit display. Use "View Visit → Rules Applied" to see which rules affected a claim.
5. Check **HCFA configuration** on the insurance carrier — global carrier-level overrides can silently change claim output.

### "Visit / claim is on hold and user can't release it"
- Determine who set the hold.
  - If the hold was set by the **EHR** (system hold): it **cannot be released from Opus RCM**. The EHR must release it. This is a known and intentional design — EHR holds have higher authority than RCM user actions.
  - 🔧 EHR If EHR holds are present and shouldn't be: escalate to Hector/Marilyn's team.
  - If the hold was set within Opus RCM (user action, carrier-level hold, or visit-level flag): it can be released from the Insurance Visits on Hold queue or by editing the visit/carrier.
- Yellow triangle icon on a visit = procedure-level hold (only one procedure held, others bill normally).
- Full visit hold = entire visit is on hold, nothing bills.

### "There are duplicate patients or duplicate claims"
- Known past bug: EHR was sending hundreds of sync requests in milliseconds, causing RCM to choke and create duplicates before acknowledging receipt. Fix was deployed (adding 500ms spacing between EHR requests). If a client reports fresh duplicates today, escalate to Imagine with account details.
- 🔍 Deanna and Imagine team can review the account audit history and identify which duplicate visits exist. Remediation must typically be coordinated with the EHR team.
- Duplicate patient records in RCM: check Demographic Import Errors queue for the duplicate icon. RCM won't auto-create duplicates — if it detects a potential duplicate based on name/DOB/address, it holds the import.

### "Insurance is updating incorrectly / volleying between EHR and RCM"
- Last write wins: whichever system last sent an update is what's reflected.
- ⚠️ Manually updating insurance in Opus RCM and then having EHR sync the same field creates a "volleyball" loop. Preferred workflow: keep insurance updated in EHR; let it sync to RCM.
- The **Demographic Updates queue** (if enabled) lets users review and accept/reject incoming EHR demographic changes before they're applied. Enable this under System Maintenance → Sending Facilities → "Automatically apply demographic updates" = off.

### "Charge Central is on but client doesn't know where their visits went"
- 🎫 This is one of the most common sources of confusion for new clients.
- Visits stuck in Charge Central **do not appear on patient accounts**. They are invisible to the account until posted from Charge Central.
- 🔧 Charge Central is enabled/disabled per sending facility (EHR environment) in System Maintenance → Sending Facilities.
- 🔧 EHR Enabling Charge Central also requires a configuration change on the EHR side. Notify Marilyn/EHR team when a client requests Charge Central be turned on or off.

### "A patient was archived and now we need them back"
- ⚠️ **Archiving is irreversible.** There is no unarchive function. Once archived, the patient cannot be restored in Opus RCM.
- The EHR will receive a sync error when it tries to sync to an archived patient. The EHR would need to re-create the patient, and RCM would create a new account.
- Archiving does NOT touch the EHR patient record — the EHR patient remains.

---

## EHR ↔ RCM Sync Reference

### What Syncs from EHR → RCM (real-time)
- **Patients** (demographic creation and updates)
- **Insurance** (carrier assignments per patient)
- **Providers** (basic demographic/NPI data)
- **Visits / Encounters** (when user initiates sync from EHR billing tab, or auto on some configurations)

### What Does NOT Sync from EHR → RCM
- Financial classes (RCM-only)
- Fee schedules (RCM-only)
- Adjustment codes / EOB codes (RCM-only)
- Payment codes (RCM-only)
- Scheduled jobs (RCM-only)
- Roles and user permissions (RCM-only)
- Custom queues and rules (RCM-only)
- Crossover codes and certain institutional billing fields (RCM-only)

### RCM → EHR Updates
- When a visit or patient record is updated in RCM, the **full account payload** is sent back to EHR.
- Whether the EHR accepts or acts on those updates is EHR team territory (not Imagine's control).
- If a diagnosis code is corrected in RCM for billing purposes, the EHR practitioner's clinical diagnosis does not change — they are separate records.

### Sync Architecture Notes
- EHR and RCM maintain **separate databases** linked by a one-time environment-level handshake (token/key pair set during implementation). This handshake is permanent per environment and ensures patients only sync between the correct pair.
- The shared unique identifier for patients is a **GUID (Global Unique Identifier)** — a long string that links the same patient across both systems. Matching is not done by name or DOB.
- Providers do not share GUIDs — they are linked via NPI matching in the Conversions module.

---

## Escalation Path

| Scenario | Owner |
|---|---|
| Claim behavior incorrect, audit history shows EHR sent wrong data | 🔧 EHR — Hector/Marilyn's team |
| EHR hold on a visit that can't be released in RCM | 🔧 EHR — Hector/Marilyn's team |
| Taxonomy/provider field overriding in RCM after sync | 🔧 EHR — fix taxonomy in EHR first |
| Charge Central toggle requires EHR config change | 🔧 EHR — notify Marilyn when enabling/disabling |
| System Maintenance setting change (client-configurable) | ✅ Tier 1 — Opus support can guide client |
| Rule or custom queue setup | ✅ Tier 1 / Tier 2 — Opus support / BH Rev |
| Clearinghouse (Phicure) claim rejection reason | 🔍 Log into Phicure portal or file ticket via ITA |
| Persistent scheduled job failure | 🔧 Imagine — file ticket via ITA |
| Bug (reproducible in sandbox, not client-specific) | 🔧 Imagine — file ticket via ITA (support.imagineparagraph.com) |
| Database-level investigation (duplicate records, raw API payload analysis) | 🔍 Imagine — Deanna or Imagine support team |
| Note deletion request | 🔧 Imagine only, and only for Opus staff errors — never for client-added notes |s