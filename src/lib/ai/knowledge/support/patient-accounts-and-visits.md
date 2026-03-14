# Patient Accounts & Visits (RCM)

## Overview

Everything inside a patient account in Opus RCM (built on Imagine/Peregrine software) — tabs, visit lifecycle, visit actions, visit defaults, notes, and unposted visits. The patient account is the **nucleus of the system**; all visits, charges, payments, and queue membership attach to it. Support investigations almost always start here.

---

## EHR ↔ RCM Sync: Core Concepts

Understanding the sync relationship prevents misrouting of support tickets.

- **EHR is the source of truth** for patient demographics, insurance, providers, and visit data on professional claims. The RCM should not be edited independently of the EHR unless the field doesn't exist in the EHR (e.g., attachments, accident codes, modifiers, institutional claim fields).
- The two systems share data via a **one-time environment-level token/key handshake** established at implementation. This handshake is permanent and never repeated. It ensures patient data from Client A never enters Client B's RCM.
- **Patients** sync from EHR → RCM nearly instantaneously (~55ms).
- **Visits** sync when a user initiates a sync from the EHR billing tab, or automatically depending on configuration.
- **Four sync categories**: insurance carriers, providers, patients, visits. Financial class, location display groupings, and some billing-specific fields do **not** sync.
- The RCM sends the **full account payload** back to the EHR after every change — every visit, demographic, insurance, everything — so the EHR can stay in sync. Whether the EHR accepts and applies those updates is an EHR-side question (ask Hector's team).
- **Last-write-wins**: If a field is edited in both systems, whoever saved last will prevail. Avoid "volleyball" edits across both systems for the same field.
- 🔧 EHR **The RCM cannot unhold a visit that the EHR has placed on hold.** Only the EHR team can release an EHR-initiated hold. These appear in the Insurance Visits on Hold queue but cannot be released from the RCM side.
- ⚠️ When the EHR sends an update the RCM cannot accept (e.g., inactive insurance, missing required field), the RCM sends back a detailed error message. The EHR may display the full text or just "Error, please contact support" — this is an ongoing area of improvement for the EHR team.
- 🔍 **Audit History** (Accounts → patient account → History tab → Audit History) shows the raw text payload received from the EHR for every sync event. This is the first tool to use when a field value differs between EHR and RCM. It shows exactly what the EHR sent, verbatim.

---

## Patient Account Tabs

### Summary Tab

The default landing screen when opening a patient account. Designed for at-a-glance visibility.

**Three sections on the Summary screen:**

1. **Top section — Demographics & Account Info**: Patient demographics, guarantor info, and overall account summary (e.g., total balance, last statement date). Configurable.
2. **Middle section — Visit List**: Three sub-tabs:
   - **Active Visits** — any visit where the balance is not zero.
   - **Completed Visits** — visits with a zero balance; considered done.
   - **Unapplied Payments** — money collected that has not been allocated to a visit yet.
3. **Right section — Recent Activity & Quick Links**: A running audit log of all account activity (system-generated and manual notes) and quick action links (reminders, ledger, secure payment, etc.).

**Customizable layout**: Each user can personalize their Summary screen via **Update Configurations**. Up to six "cards" can be displayed at a time from a library of options. Users can also choose a default view preset (e.g., Payments view, Procedures view, History view) that loads on entry to any patient account. The underlying data is always accessible regardless of view; this only changes what is shown by default.

**Visit sub-list behavior**: Each visit row in the Active or Completed tabs can be **expanded** to show a nested view including service date, procedure codes, diagnosis, provider, payment details, and more — all without leaving the Summary tab.

🎫 **Common ticket**: "The visit balance doesn't look right" — check the Active vs. Completed tabs. A zero-balance visit moves to Completed and disappears from Active.

---

### Visit Tab

Grid view of all visits for this patient across all statuses. Useful for a tabular overview rather than the nested card view on the Summary tab.

---

### Patient (Demographics) Tab

Patient demographic fields. **Changes made here sync back to the EHR** (the RCM sends the update; whether the EHR accepts it is EHR-side behavior). This includes date of birth, name, address, etc.

⚠️ If a demographic field is corrected in the RCM, the EHR may overwrite it on the next sync if the EHR still has the old value. Resolve at the EHR source when possible.

---

### Guarantor Tab

The guarantor is the **financially responsible party** — not necessarily the patient (e.g., a parent for a minor). Controls:
- Who receives paper/email/text statements.
- **Correspondence settings**: opt-in/opt-out for text and email statements (Imagine Everywhere). Users can set opt-out from this tab.
- Guarantor information syncs from the EHR.

🎫 If a patient is not receiving statements, check the Guarantor tab for opted-out correspondence flags before escalating.

---

### Insurance Tab

**Patient-level insurance** vs. **visit-level insurance** are different concepts:
- **Patient-level insurance** (this tab): the default insurance plans on file. Syncs from EHR. Best practice is to keep insurance current in the EHR, because the clinical team may need it for prior auth and eligibility checks before service.
- **Visit-level insurance**: Each visit can have its own insurance that differs from the patient default. Examples:
  - No-show → self pay
  - Auto accident → auto insurance rather than health insurance
  - EHR passes the insurance for that specific visit at sync time.

**Responsible Party flag**: When insurance on a visit is switched to self pay, a "responsible party" flag toggles automatically to indicate the patient owes the money. Can be manually flipped.

**Hold Patient Billing / Hold Insurance Billing**: Checkboxes on the visit that prevent claims or patient statements from going out. Can be set per-visit or at the patient account defaults level.

⚠️ **Adding insurance in the RCM vs. EHR**: The RCM will accept insurance added directly, but it's better practice to add it in the EHR first so the clinical team has visibility for auth/eligibility purposes.

⚠️ **Deactivating an insurance carrier** in System Maintenance makes it unavailable for new visits but does not remove it from existing visit records. The EHR will receive a sync error if it attempts to assign that deactivated carrier to a new visit.

🎫 If the RCM shows a different insurance than the EHR: use **Audit History** to see the raw payload the EHR sent. Discrepancy is almost always sourced from EHR data or a conversion mapping issue.

---

### History Tab

Contains several sub-views:
- **Billing History**: Claim send history — when claims were transmitted, to which payer.
- **Claim Status**: Responses received back from Phicure/payers.
- **Eligibility**: Results of eligibility checks run on this patient.
- **Statements**: Statement send history.
- **Audit**: All EHR sync events for this patient — source of the **Audit History** payload files used for troubleshooting discrepancies.

🔍 Audit History is viewable only for events after this feature was released (~October 2025). Events before that date are not logged here.

---

## Visit Lifecycle

A visit (encounter) moves through the following stages:

1. **Created in EHR** → syncs to RCM via API (or created manually in RCM, not recommended).
2. If **Charge Central is enabled**: visit enters Charge Central queue and does **not** appear on the patient account until a biller reviews and posts it.
3. Once on the patient account: the system **immediately and automatically begins scrubbing** the visit for errors. This cannot be stopped or delayed.
4. If errors found: visit drops to **Pre-Submission Errors** queue. It will not be billed until all errors are resolved.
5. If no errors (and not on hold): visit moves to **Outgoing Insurance Claims** queue to await the scheduled claims send job.
6. Claims job runs → claim transmitted to **Phicure** clearinghouse → Phicure routes to payer.
7. Payer **accepts** (claim enters adjudication) or **rejects** (structural error, never entered payer system).
8. If accepted → payer **pays** or **denies**.
9. Remittance comes back through Phicure → **Fetch Remittance job** imports ERA/EOB → payment posted to visit.
10. If patient balance remains: statement cycle begins; patient billed via text/email/paper (Imagine Everywhere) or manually.
11. Balance reaches zero → visit moves to **Completed**.

**Key distinction — Rejection vs. Denial:**
- **Rejection**: Claim never entered payer system. Structural error (wrong code format, missing required field, invalid date). No claim number assigned by payer. Appears in **Claim Status** queue. Fix the structural issue and rebill.
- **Denial**: Claim entered payer system, adjudicated, and payer refused payment (no auth, plan doesn't cover, patient ineligible, etc.). A payer claim number (ICN) is assigned. Appears in **Denied Procedures** queue. May require appeal.

⚠️ A visit can be in **multiple queues simultaneously**. The exceptions button on the patient account (showing a count badge) lists every queue the patient's visits currently appear in, with specific error reasons per visit.

---

## Visit Actions (Meatball Menu ⋯)

The three-dot menu on each visit row. Available from both the Summary tab visit list and queue views.

### Bill / Bill Visit
- Manually queues a visit to be sent as a claim. Options:
  - **Print** — generates an HCFA paper claim for manual mailing (rarely needed; "that's 1984").
  - **Bill Electronically** — adds to Outgoing Insurance Claims queue.
  - **Corrected Claim** — requires the **ICN** (payer's original claim number from the remittance/EOB). Sends an 837 with corrected claim indicator.
  - **Void** — voids a previously sent claim. Payer will recoup any money already paid. Also requires the ICN.
- ⚠️ **Remove Billing**: removes the visit from any billing queue and flags it to not be billed. Distinct from voiding.

### Corrected Claim
- Used when a claim was submitted with an error and has already been accepted by the payer.
- **Requires the ICN** from the payer's EOB/remittance. The ICN is the payer's internal claim number returned when the claim was adjudicated.
- Generates a new 837 with the "corrected claim" indicator pointing to the original.
- ⚠️ Sending a corrected claim counts as a new claim for billing/usage counting purposes.

### Void
- Sends a void transaction to the payer for a previously adjudicated claim.
- **Requires the ICN.**
- Payer will recoup any payments already made.
- Used when a claim was sent in error (e.g., patient canceled, note not yet written).

### Merge Visits
- Combines two visits into one. Use case: multiple providers saw a patient in one day and the bill needs to go out as a single claim with combined units.
- **Destructive and irreversible.** The source visit is permanently gone. No unmerge.
- The merged-from visit number will never appear on this account again.
- ⚠️ **Sync error after merge**: If the EHR later tries to re-sync the visit that was merged away, it will receive a sync error because that visit no longer exists in the RCM. The EHR team is aware and working on handling this gracefully but it is not yet resolved.
- The merge event is recorded in the account notes log with the user's name.

### View Visit
- Read-only expanded view of all visit fields: procedure codes, modifiers, diagnosis codes, auth numbers, provider, insurance, payment activity, rules applied, etc.
- **Rules Applied** button: shows which billing rules were applied to this visit at billing time. Rules do **not** change the underlying visit record — they alter only what goes out on the claim. If a client says "I see the modifier on the visit but the payer didn't get it," check Rules Applied to confirm the rule ran.

### Edit Visit
- Full editable view of the visit. Allows changing modifiers, diagnosis, auth number, providers, place of service, insurance, hold flags, and more.
- ⚠️ **Cannot delete procedures** from a visit once saved or queued. If a procedure needs to be removed, void the claim and create a new visit.
- Changes saved here are sent back to the EHR as a full account payload update.
- 🔧 EHR Once a visit has been reviewed/approved by a biller (posted through Charge Central), the EHR will be blocked from overwriting it. This is a work-in-progress feature to prevent clinical teams from breaking already-reviewed billing. Error message presented to EHR users: "This has been approved/reviewed by the billing team. Please contact them if you want to make changes."

### Write Off
- Adjusts the visit balance to zero using a write-off adjustment code. Used for uncollectible amounts (e.g., denial with no appeal path, small balance, collections).
- Permanently reduces expected revenue; should be used deliberately.

### Refund Visit
- Initiates a refund workflow when a visit has a credit balance (overpayment).
- Creates a refund memo/record in the RCM. **Does not print or send a check** — the practice must cut the actual check through their accounting software (e.g., QuickBooks).
- If the original payment was made via **Imagine Pay** (card/bank), the meatball menu will show an **Imagine Pay Refund** option that can reverse the charge back to the card.
- ⚠️ Before creating a refund, check whether the credit on this visit can be applied to a balance on another visit first. Moving a payment from one visit to another via a manual batch transaction avoids the need to issue a refund check.

### Assign to Follow Up
- Adds the visit to the **Follow Up queue** assigned to a specific user with a scheduled date and note.
- One of the few places where users can manually add something to a queue.
- Can be re-edited to extend the date or change the assignee.

### Assign to Collections
- Marks the visit's patient balance for the collections process.

---

## Visit Defaults

Defaults reduce manual data entry when adding visits and help ensure clean claims from the start.

### Patient-Level Defaults
Set under the **Patient** tab → **Patient Defaults** section. Applies only to this patient's new visits:
- Default location
- Default place of service
- Default attending provider
- Default referring provider
- Default diagnosis code

### System-Level Defaults
Set in **Settings → Edit Practice Information**. Applies globally to all new visits for all patients in this data set:
- Default attending provider
- Default referring provider
- Default place of service

Best use case for system defaults: single-provider practices where every visit has the same provider, location, and POS.

---

## Notes & Audit Log

### Notes Panel
Accessible via the **+** icon on the right side of the patient account. Contains:
- **System-generated notes**: Automatically written for every action on the account — billing events, merges, edits, sync updates, payments, queue assignments. If the action came from the EHR sync, the author shows as **"system"** (the EHR user is not known to the RCM).
- **Manually keyed notes**: Free-text notes entered by billers. Visible to all RCM users on the account.

**Notes are permanent.** They cannot be deleted by any user, including Imagine staff (doing so would violate audit/compliance certifications). The only exception is Imagine engineering can manually edit note text at the database level for Opus staff entries if legally necessary — this will never be done for client account notes.

⚠️ Notes (including system notes) can appear on **Account Ledger** reports and **Patient Receipts** if not filtered out. Instruct clients to review note content before sharing account ledger with patients or attorneys.

**Filtering notes**: Type keywords in the notes filter box (e.g., "merge", "billing", a visit number). No advanced filter UI, but keyword search covers most use cases.

**Notes are per-account.** Each patient account has its own isolated notes log.

### Account-Level Alert (Sticky Note / Speaker Icon)
- The speaker icon on the account allows setting a prominent, front-and-center alert visible to all users opening this account.
- Use for billing team communications (e.g., "Do not bill — patient in dispute").
- Clear by clicking the alert area and selecting "Clear."

### Reminders (Bell Icon)
- Creates a notification that appears in the user's notification bell on or after a scheduled date.
- Similar to a personal task. Does not appear until the due date.
- Distinct from Follow Up queue entries: reminders are more "urgent notification" style, follow-up items are more "worklist" style.
- Failed scheduled jobs (e.g., claims job failure) generate automatic reminders to the job's assigned user.

---

## Unposted Visits

The **Unposted Visits** button on the patient Summary tab (not to be confused with unposted/unapplied payments):
- When clicked, performs a **live API call to the EHR** to retrieve all scheduled appointments for this patient that have not yet been synced to the RCM.
- Gives billers a forward-looking view of upcoming visits without leaving the RCM.
- Informational only — cannot post or act on these from here; they must be synced from the EHR billing tab.

---

## Unapplied Payments

Payments collected but not yet allocated to a specific visit. Three sources:

1. **EHR-originated payments**: Payments collected at the front desk via the EHR's payment screen come to the RCM as unapplied, because the EHR does not know which visit to apply them to. A biller must allocate them.
2. **Manual unapplied**: A user intentionally collects a payment without allocating it (e.g., a prepayment from a patient who hasn't been seen yet).
3. **Statement/Imagine Pay**: Payments made via QR code on paper statements or the Imagine Pay patient portal generally auto-apply (next business day for QR code payments). Failures appear in the **Imagine Pay Unapplied** queue.

**To allocate an unapplied payment**: Open the unapplied payment, select the batch (new or existing), select the visit(s), enter the allocation amounts, save. The batch must then be **posted** to finalize the accounting.

⚠️ An unapplied payment does not reduce any visit balance until it is allocated and the batch is posted. The account will still show the full balance as owed until that step is complete.

🎫 Clients who collect prepayments up front and apply them later will have chronic unapplied payment queues. This is expected behavior, not a bug.

---

## Secure Payment / Imagine Pay

- **Secure Payment** button on the patient account triggers the Imagine Pay payment widget (a separate Imagine-owned product).
- Allows the biller to allocate the payment to specific visits/procedures before charging the card.
- Supports: credit/debit card, bank account (ACH/check), cash, other.
- **Pay Now**: immediate charge.
- **Tokenize**: stores card for future use; PCI-compliant (Imagine stores a token, not the card number).
- Generates an email/printable receipt on completion.
- ⚠️ **Non-Imagine Pay payment sources** (Square, Stripe, physical card reader not linked to Imagine Pay): must be manually entered as a payment record every time. Will not auto-flow into the RCM.
- 🔧 **Automatic Payments**: Must be enabled in **Settings → Edit Practice Information → Allow Automatic Payments**. Once enabled, patients can have cards on file charged on a schedule (weekly, monthly, custom interval). The patient-balance option will charge whatever the current balance is; the custom amount option requires an end date.

---

## Institutional Billing Notes

- Institutional claims (UB-04 / 837I) display differently in the visit add/edit screen — additional fields appear: date of event, accident type, admit/discharge dates, etc.
- Claim type (professional vs. institutional) is driven by the **insurance carrier's claim type setting** in System Maintenance → Insurance Carriers.
- Institutional billing fields generally cannot be managed from the EHR. Most institutional claim work is done directly in the RCM.
- 🔧 Institutional billing must be enabled on the data set (System Maintenance → Data Set → check "Institutional Billing"). When not checked, institutional maintenance options are hidden from System Maintenance entirely.

---

## Common Issues & Support Troubleshooting

### 🎫 "I can't find this patient in the RCM"
**Ordered checks:**
1. **Demographic Import Errors queue** — patient exists in a pre-commit state, blocked by a missing required field (usually the same field missing in the EHR). Resolve by filling in the required field and posting.
   - ⚠️ If a duplicate is suspected, a duplicate icon appears in this queue. Don't create a second account.
   - 🔧 EHR If the required field is missing in the RCM, it's almost certainly missing in the EHR too. Fix it there first.
2. **Charge Central queue** (if enabled) — patient account may exist but visits are being held. The patient account only shows visits that have been posted through Charge Central.
3. **File Import** (Accounts → File Import) — shows every API call ever received from the EHR in raw text. Search by patient name, MRN, or other identifier to confirm whether the sync message ever arrived. If it arrived but didn't create an account, Demographic Import Errors is the cause.
4. **Sync error in the EHR** — check the EHR billing tab for RCM sync errors. Resolving the error there will retry the sync.
5. 🔧 EHR If none of the above and the patient cannot be located anywhere, there may have been a timing/volume issue where the EHR sent the request but the RCM didn't acknowledge receipt, causing the EHR to not retry. File an escalation ticket.

---

### 🎫 "Visit won't send / claim won't go out"
**Ordered checks:**
1. **Exceptions button** on the patient account — shows every queue the visit's procedures are currently in and the specific reason. This is the fastest starting point.
2. **Pre-Submission Errors queue** — if it's here, there is a hard block on the claim. Read the error message carefully:
   - "Referring Provider NPI required" → go to System Maintenance → Providers → find the provider → add NPI. The claim will automatically re-queue once the NPI is saved.
   - "Attending Provider NPI required" → same fix.
   - "Diagnosis code required" / "Procedure code required" → edit the visit and add the missing data.
   - Fixing one provider NPI fixes **all** claims across all patients held for that same reason simultaneously.
3. **Insurance Visits on Hold queue** — check if the insurance carrier itself has "Hold Billing" checked in System Maintenance → Insurance Carriers. Also check if the individual visit or procedure has a hold flag checked (Edit Visit → Hold Insurance Billing / Hold Patient Billing).
   - 🔧 EHR If the hold was set by the EHR, it **cannot be released from the RCM**. The EHR team must release it.
4. **Charge Central** — if enabled, the visit may be sitting in Charge Central and not yet posted to the patient account. It will not appear on the patient account until posted.
5. **Financial class / carrier enrollment** — if the payer hasn't been enrolled through Phicure yet, hold the carrier until enrollment is complete to avoid mass rejections.
6. **Outgoing Insurance Claims queue** — if the visit is here, it's waiting for the next scheduled claims job to run. Check the scheduled job setup to confirm a send claims job is configured and active.

---

### 🎫 "Data shows differently in EHR vs. RCM"
1. Open the patient account → **History tab → Audit History**.
2. Find the relevant sync event (by date/visit).
3. Download the raw payload file and open in a text editor.
4. The file shows exactly what the EHR sent to the RCM. If the RCM data matches the payload, the problem is in what the EHR sent — escalate to EHR team (Hector's team).
5. If the RCM data does NOT match the payload, there may be a **conversion mapping** issue or a **rule** that altered the data at billing time. Check System Maintenance → Conversions and Rule Builder.

---

### 🎫 "Merge was done accidentally"
- Merges are **irreversible**. There is no unmerge.
- The source visit's number no longer exists anywhere on the account.
- The merge event is visible in the account notes log (search "merge").
- 🔧 If the EHR attempts to re-sync the merged-away visit, it will receive a sync error. This is expected and logged. The EHR team may need to handle how they present this error to clinical users.

---

### 🎫 "Notes were accidentally added"
- Notes cannot be deleted by any user, client, or Opus staff.
- The only exception is Imagine engineering can edit Opus-staff-authored note text at the database level in extreme circumstances (will never be done for client-authored notes for audit/compliance reasons).
- Instruct the client that notes are visible to other internal RCM users but **not** to the patient — unless the client generates an Account Ledger and includes notes in the output (controllable when generating the ledger).

---

### 🎫 "Claim was cleared from a queue accidentally"
- **Clear from Queue is irreversible.** The item is removed from that queue permanently.
- However, the visit/claim still exists on the patient account and in all other applicable queues. It is not deleted — just removed from focus in that one queue.
- You can manually add it to the **Follow Up queue** from the patient account (meatball menu → Assign to Follow Up) to ensure it gets worked.
- If a large batch was accidentally cleared from Claim Status, the raw responses are still in the Phicure portal and can be re-fetched if needed. File an escalation ticket.

---

### 🎫 "Duplicate patient accounts / duplicate claims"
- 🔧 EHR This was a known bug (~November 2025) where the EHR was sending hundreds of sync requests within milliseconds. The RCM processed some but couldn't acknowledge receipt fast enough, causing the EHR to resend, resulting in duplicates. A fix was deployed to add spacing between requests (conveyor belt processing).
- If duplicates are still seen: check File Import for the raw payloads, then escalate to Imagine with a ticket. The duplicate account list should be resolved via the EHR team.
- Duplicate accounts in **Demographic Import Errors** can be deleted (one of the few places where hard delete is allowed, because the record hasn't been committed to the database yet).

---

### 🎫 "Visit sync takes too long after clicking sync in EHR"
- Expected behavior. Processing time scales with volume per tenant.
- A single visit: nearly instant.
- Bulk syncs (50–1,000 visits): may take several minutes due to conveyor-belt processing.
- There is no hard upper time limit. If volume is extremely high, it will take longer. No SLA currently documented for bulk syncs.
- Advise clients to use automation (scheduled jobs, auto-apply settings) rather than watching every sync in real time.

---

## Escalation Reference

| Symptom | First Check | Owner |
|---|---|---|
| Patient missing from RCM | Demographic Import Errors, File Import | Support (Tier 1), then EHR team if data was never sent |
| Visit not on patient account | Charge Central (if enabled) | Support (Tier 1) |
| Claim stuck, not going out | Pre-Submission Errors, Insurance Visits on Hold | Support (Tier 1) |
| EHR hold that can't be released | Accounts → visit exceptions | 🔧 EHR — EHR team must release |
| Data mismatch EHR vs. RCM | History → Audit History | Support → EHR team if payload shows EHR sent wrong data |
| Billing rule not applying as expected | View Visit → Rules Applied; also check HCFA config on carrier | Support (Tier 1/2), Imagine if rule confirmed correct but claim wrong |
| Auth number missing on claim | View visit for auth field; check EHR utilization manager | EHR team (99% of the time auth wasn't sent from EHR) |
| Duplicate claims | File Import audit; account notes | Imagine escalation ticket |
| Unapplied payment not auto-posting | Check Imagine Pay Unapplied queue; verify scheduled job for receive Imagine Pay is running | Support (Tier 1) |
| Bug / behavior not replicable in sandbox | Submit ticket via ITA ticketing system (support.imaginesoftware.com area) | Imagine support (Deanna / Imagine team) |
| Phicure clearinghouse question / Phicure rejection | Phicure portal for raw claim response | File a Phicure clearinghouse request ticket in ITA |