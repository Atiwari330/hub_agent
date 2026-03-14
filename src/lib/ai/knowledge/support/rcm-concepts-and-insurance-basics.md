# RCM Concepts & Insurance Basics

## Overview

Foundational revenue cycle management concepts that inform how billing works in the Opus ecosystem. Understanding these concepts is essential for troubleshooting claim denials, payment issues, and billing configuration questions.

Opus RCM does not start tracking a patient's financial record until after a visit is synced from Opus EHR. Everything before that (scheduling, documentation, clinical notes) lives in the EHR. The RCM's sole job is to get claims out the door and payments back in as fast as possible.

---

## Insurance Fundamentals

### Deductibles
- The amount a patient or family must pay out-of-pocket before insurance begins covering services.
- Two types: **individual deductible** (per person) and **family deductible** (a shared pot for the entire household).
- Once the deductible is met, the insurance begins contributing — but the patient may still owe coinsurance.
- 🎫 Common support question: "Why is insurance paying $0?" — often because the patient's deductible has not been met yet.

### Copay
- A **fixed dollar amount** the patient pays per visit, regardless of what the provider charges or what insurance allows.
- Does not change based on billed amount. Example: $25 per visit, always $25.
- Different copays may apply for different provider types (primary care, specialist, emergency, mental health).

### Coinsurance
- A **percentage of the allowed charge** that the patient is responsible for after the deductible is met.
- Unlike a copay, this amount changes based on what the insurance allows.
- Example: 20% coinsurance on a $100 allowable = patient owes $20. On a $150 allowable = patient owes $30.

### Maximum Out-of-Pocket
- The maximum total the patient/family will pay in a year before insurance covers 100% of the allowable amount.
- Applies across all providers and services, not just one practice.
- ⚠️ Out-of-network maximum out-of-pockets can be extremely high (examples have reached $99,999). This is why patients seen out-of-network may owe nearly everything.

### Write-Off
- **Not** a tax write-off. In medical billing, a write-off is an amount the provider has agreed contractually never to collect.
- Example: Provider bills $100, Blue Cross allowable is $75. The $25 difference is a write-off — neither the insurance nor the patient will ever pay it, per the signed contract.
- Write-offs can also occur at the billing level for denied or uncollectable balances. In Opus RCM, write-offs are processed through adjustment codes.

### Coordination of Benefits (COB)
- Rules governing which insurance pays first when a patient has multiple insurance plans.
- **Medicaid is always the payer of last resort** — by federal law. Medicaid is never billed primary if another insurance exists.
- Medicare, TRICARE, and other government payers have their own COB rules.
- Most states have specific COB laws. Example: in North Carolina, when both parents have coverage for a child, the parent whose birthday falls earliest in the calendar year is primary.
- **Primary → Secondary → Tertiary** is the billing order. Quaternary insurance exists in theory but is extremely rare in practice.
- 🎫 Common question: "How do we know which payer is primary?" — answer depends on state law, payer type, and plan terms.

### Accept Assignment
- When a patient (and provider) agree that the insurance company will pay the provider directly.
- Most in-network providers accept assignment by default.
- Some insurance companies will not pay the provider directly if the provider is out-of-network, even if the box is checked.

### Prior Authorization
- Approval from the insurance company required before certain services can be performed.
- Provider submits the request with supporting documentation (sometimes a letter from a PCP).
- Undergoes insurance review before services begin.
- ⚠️ If prior authorization is required and not obtained, the claim will be denied. The authorization number must be attached to the visit in the EHR (utilization management screen) before or at the time of billing.

### Referral
- A prescription or order from one provider directing the patient to see another provider. Required by some insurance plans.
- Distinct from a prior authorization, though both may be required simultaneously.

### Super Bills
- A patient receipt that includes provider name, Tax ID, NPI, CPT codes, diagnosis codes, and amount paid.
- Used by **out-of-network providers** who don't bill insurance directly.
- The patient takes the super bill and submits it to insurance for reimbursement themselves.
- Not processed through Opus RCM.

### Fee Schedule
- A list of procedures and the contracted/expected payment rate for each from a specific insurance carrier.
- In Opus RCM, fee schedules are entered under **System Maintenance → Fee Schedules** and linked to insurance carriers.
- Drives two key functions: (1) fills in the **allowed amount** during transaction posting, and (2) populates the **Underpaid Procedures queue** when the payment received is less than the expected fee.
- If no fee schedule exists for a carrier (e.g., out-of-network), the underpaid queue will not be populated, and allowed amounts will not auto-fill — but billing still works normally.
- One fee schedule can be linked to multiple carriers (e.g., all carriers paying at Medicare rates can share one Medicare fee schedule).
- Fee schedules can be uploaded via CSV and adjusted by percentage (e.g., to reflect a payer reducing rates).

---

## Key Documents & Standards

### EOB (Explanation of Benefits)
- Document from the insurance company explaining how a claim was adjudicated: what was covered, how much was paid, how much was discounted, and what the patient owes.
- Both the patient and the provider receive an EOB (provider's copy is typically electronic).
- Contains: patient info, subscriber number, rendering provider, claim number, CPT code, amount charged, discount, amount paid to provider, patient responsibility.

### ERA (Electronic Remittance Advice)
- The electronic version of an EOB — transmitted through the clearinghouse back to Opus RCM.
- Used for automated payment posting (the **Fetch Remittance** scheduled job retrieves these).
- Contains **EOB reason codes** (e.g., PR-1 for deductible, CO-45 for contractual adjustment) that Opus RCM uses to determine how to post and whether to route to queues like Denied Procedures or Underpaid Procedures.
- ⚠️ ERA reason codes are industry-standard X12 codes — there are hundreds of them. Not all indicate a denial. For example, code 133 ("Claim pending further review") is informational, not a denial.

### CMS-1500 (HCFA Form)
- The **standard claim form for professional (outpatient) billing** in the United States.
- Also historically called the **HCFA** (Healthcare Financing Administration) form. Many experienced billers still use this term. "HCFA" and "CMS-1500" refer to the same form.
- Printed in red ink so that scanners can filter out the red template and read only the black data entries.
- Contains: payer type, patient info, dates of service, place of service, CPT code, modifiers, diagnosis codes (up to 4 per procedure line), charges, units, and rendering provider.
- Opus RCM transmits the electronic version of this form — an **837P** (ANSI 837 Professional) file — not the paper form itself. The paper form can still be printed from within Opus RCM if needed.

### UB-04 (Institutional Claim Form)
- The equivalent of the CMS-1500 for **institutional billing** (hospital stays, SNFs, inpatient).
- Electronic equivalent is an **837I** (ANSI 837 Institutional).
- Significantly more complex than the CMS-1500. Includes additional fields: frequency code, facility codes, occurrence codes, condition codes, and more.
- Opus RCM supports institutional billing. Institutional claim fields must generally be managed within Opus RCM directly (not synced from EHR).
- ⚠️ Institutional billing is a separate module in Opus RCM and only appears in System Maintenance if institutional billing is enabled at the data set level.

---

## Code Systems

### ICD-10 (Diagnosis Codes)
- International Classification of Diseases, 10th Edition. Used globally.
- ~85,000 codes exist. US medical billing requires coding to the **highest degree of specificity**.
- ⚠️ Using a non-specific ICD-10 code will result in a claim rejection or denial. Non-billable/non-specific codes appear in red on **ICD10data.com** and will show the more specific child codes that should be used instead.
- Each procedure can have **up to 4 associated diagnosis codes**.
- ICD-11 is not yet in use in the US. The transition from ICD-9 to ICD-10 took ~8–10 years; ICD-11 is not expected to be mandated for the foreseeable future.
- Mental health and developmental ICD-10 codes should not be mixed with medical/surgical codes inappropriately on behavioral health claims.
- 🎫 Common support issue: Claim rejected with message like "must be coded to highest degree of specificity" — check the ICD-10 code on the visit. If it is a parent/non-billable code (shown in red on ICD10data.com), the biller must update it to a more specific child code.
- 🔧 EHR Diagnosis codes sent from EHR that do not match a code in Opus RCM will appear in **System Maintenance → Conversions → Diagnosis** and will cause visits to drop to **Procedure Import Errors**. Diagnosis codes auto-link by code value if a match exists — no manual mapping needed unless the EHR sends a code the RCM doesn't have.

### CPT (Procedure Codes)
- Current Procedural Terminology codes identifying the service performed.
- Common behavioral health CPT codes include: 90791 (psychiatric diagnostic evaluation), 90832/90834/90837 (psychotherapy by duration), 90838 (psychotherapy add-on), 99202–99215 (E&M codes).
- In Opus RCM, procedure codes are configured under **System Maintenance → Procedures**. Each procedure can have a default fee, default modifiers, and insurance-code-level overrides.
- ⚠️ Special characters in procedure codes can corrupt outgoing electronic claim files. Use only letters and numbers in codes.

### Modifiers
- **Two-character codes** (letters, or a letter + number) appended to CPT codes to provide additional billing context.
- Always exactly 2 characters.
- Common modifiers in behavioral health:
  - **95** — telehealth services
  - **GT** — interactive audio and video telecommunications (telehealth)
  - **HO, HN, HM** — provider credential level (e.g., master's, bachelor's, unlicensed)
  - **U1–U9, UD** — state-specific Medicaid modifiers
  - **25** — significant, separately identifiable E&M service on the same day
- In radiology: **LT** (left), **RT** (right) — not relevant for behavioral health but illustrative.
- ⚠️ Missing or incorrect modifiers can cause a claim to be rejected or denied. This is one of the most common causes of claim failure.
- In Opus RCM, modifiers can be configured as defaults on procedure codes, and **Rules** can be used to automatically add, remove, swap, prepend, or suppress modifiers based on conditions (e.g., insurance carrier, provider, place of service).
- ⚠️ Rules apply **at billing time only** — they do not change what appears on the visit in the patient account. If a client says "the modifier isn't showing on the visit," that is expected behavior. The modifier will appear in the outgoing claim file (visible via Phicure portal).

### Place of Service Codes
- Standard codes identifying where care was delivered.
- Common codes: **11** = office, **02** = telehealth, **10** = telehealth in patient's home, **12** = patient's home.
- ⚠️ Some payers have specific place-of-service requirements that differ from standard. Example: North Carolina Medicaid does not accept POS 10 — providers must bill POS 11 (their usual place of service) and add a telehealth modifier instead.
- The **Place of Service Crosswalk** in System Maintenance → Insurance Carriers allows automatic remapping of one POS code to another for a specific payer, paired with a modifier rule to add the required telehealth modifier.
- 🎫 Support issue: "Claim rejected — invalid place of service." Check the POS on the visit; check if the insurance carrier has a crosswalk configured; check if a rule is needed to add a modifier.

---

## Clearinghouse Role

### Phicure
- The clearinghouse used exclusively by Opus RCM to submit claims to payers and receive responses.
- **Opus RCM does not communicate directly with insurance payers.** All claim transmission and remittance flows through Phicure.
- Acts as a single aggregator: Opus RCM sends all claims to Phicure, and Phicure routes them to the appropriate payer; payer responses flow back through Phicure to Opus RCM.
- **Transcription note:** In training recordings, "Phicure" may be auto-transcribed as "FiCare," "fi care," "phi care," "Ficare," or other phonetic variants. All refer to the same clearinghouse, Phicure.
- Combined, Opus RCM and Phicure perform **over 5,000 scrubbing checks** on each claim before it is transmitted to a payer.
- Phicure has its own **portal** that support staff can log into to view raw claim data, submission status, and remittance files. This is a key troubleshooting tool when comparing what was sent vs. what Opus RCM received.
- 🔧 Phicure enrollment: New clients must complete claim enrollment through Phicure before claims to certain payers (especially Medicare) will be accepted. Until enrollment is complete, those claims should be held (set "Hold Billing" on the carrier in System Maintenance) to avoid unnecessary rejections.
- 🎫 A Phicure-specific support request (e.g., enrollment question, EDI issue) can be submitted directly through the ITA ticketing system using the **Phicure Clearinghouse Request** ticket type — this routes directly to Phicure without waiting for Imagine.

### Phicure Payer ID Special Values
- Two special keywords can be entered as the **Payer ID** on an insurance carrier in System Maintenance to control routing behavior:
  - **`paper`** — Instructs Phicure to print and mail the claim on behalf of the client (the clearinghouse handles physical printing and mailing). ⚠️ This is distinct from selecting "Professional Paper" claim type in Opus RCM (which prints from within RCM itself).
  - **`error`** — Tells Phicure to ignore the claim entirely. Used when a client bills a payer that is not a standard insurance carrier (e.g., a church, employer group, or blood drive) and handles that billing outside of Phicure.

---

## Revenue Cycle Lifecycle

### Overview
The full lifecycle from patient encounter to payment collection. Opus RCM engages only after the visit is synced from the EHR.

### Step-by-Step Claim Flow

1. **Patient is seen in the EHR.** Scheduling, documentation, and clinical notes all live in Opus EHR. Documentation does not need to be complete before billing — but completing it before syncing is best practice for audit compliance.

2. **Patient account syncs to RCM.** When a patient is created in Opus EHR, a corresponding account is created in Opus RCM within ~55 milliseconds via a real-time API. The two systems use separate databases but are linked by a permanent environment-level token/key handshake (set once at onboarding, never changes). Patients are matched by a **GUID (Global Unique Identifier)** — a long, unique string of characters that links the same patient across both systems.

3. **Visit (encounter) syncs to RCM.** Users initiate a sync from the EHR billing tab. In some configurations this may be automatic. The RCM receives the visit payload (date of service, procedure codes, diagnosis codes, provider, insurance, etc.).
   - ⚠️ If **Charge Central** is enabled, synced visits are held for manual review and do **not** appear on the patient account until posted by a biller. This is a very common source of "why can't I see this visit?" support tickets.
   - If Charge Central is off, the visit posts directly to the patient account.

4. **Automatic scrubbing begins.** As soon as a visit is posted to the patient account, Opus RCM immediately begins checking it for errors. This cannot be stopped or delayed. Over 5,000 checks are run between RCM and Phicure. Examples of things checked: patient name/DOB/sex/address present, procedure code present, diagnosis code present and specific, rendering provider NPI present, referring provider NPI present (if required), place of service valid, date of service not in the future, patient sex = male or female (no other values accepted on claims).

5. **Pre-Submission Errors queue.** If any scrubbing check fails, the visit drops to the **Pre-Submission Errors** queue. Visits in this queue **will not be billed** until the errors are resolved. This is the last hard gate before a claim leaves the system. Once the error is fixed (e.g., adding an NPI to a provider in System Maintenance), the system automatically re-scrubs and, if clean, moves the visit to the **Outgoing Insurance Claims** queue — no further action needed from the user.

6. **Outgoing Insurance Claims queue.** A staging bucket. Claims accumulate here until the **Send Claims** scheduled job runs. When the job runs, all claims in this bucket are transmitted to Phicure and the queue resets to zero. ⚠️ If claims are still visible in this queue after the job has run, that is a potential bug — escalate to Imagine.

7. **Phicure transmits to payer.** Phicure routes the 837P (or 837I for institutional) to the appropriate payer.

8. **Payer response — Rejection or Acceptance:**
   - **Rejection:** The claim does not meet the structural requirements of the payer's intake system. The payer never adjudicates it. The claim does **not** have a payer-assigned claim number (ICN). The rejection routes to the **Claim Status queue** in Opus RCM. Examples: subscriber ID wrong format, non-billable ICD-10 code, future date of service.
   - **Acceptance:** The payer received the claim and will process it. A claim number (ICN) is assigned. The claim proceeds to adjudication.

9. **Payer response — Denial or Payment (after acceptance):**
   - **Denial:** The payer accepted the claim structurally but declined to pay it. A claim number exists. An EOB/ERA is generated with denial reason codes. Depending on the EOB code setup in System Maintenance, the visit may route to the **Denied Procedures queue** and/or **Follow Up queue**.
   - **Payment:** The payer pays the allowed amount (or a portion). An ERA is received via Phicure and posted to the patient account via the **Fetch Remittance** scheduled job.

10. **Post-payment balance disposition:**
    - If **balance = $0**: visit is complete.
    - If **balance = patient responsibility**: balance is released to the patient. Statements are generated and sent per the **Financial Class** statement cycle configuration.
    - If **secondary/tertiary insurance**: claim re-scrubbed and re-submitted to the next payer.
    - If patient balance goes unpaid: delinquency codes increase with each statement cycle. After the configured number of statements, the visit may auto-route to **Collections**.

11. **Collections:** Only patient-responsible balances can go to collections. Collections are triggered by statement count (delinquency code), not by number of rejections. Visits assigned to collections appear in the **Collections queue**. An automated collections export file can be generated and sent to an external collections agency. Visits sent to collections that are written off receive a **collections write-off** adjustment code.

### Key Distinctions

| Term | Meaning | Has Claim Number? | Can Appeal? |
|---|---|---|---|
| **Rejection** | Claim failed structural intake at payer or clearinghouse | No | No — fix and resubmit as new claim |
| **Denial** | Payer accepted but declined to pay | Yes (ICN) | Yes — submit corrected claim referencing ICN |
| **Write-off** | Amount contractually or administratively removed from balance | N/A | N/A |

- **Corrected claim**: Requires the original ICN from the payer. Use "Bill Visit → Corrected Claim" in Opus RCM.
- **Void claim**: Instructs payer to cancel a previously paid claim and recoup payment. Also requires ICN.

---

## Common Issues in Support Tickets

### "Claim denied for diagnosis code"
- Verify the ICD-10 code is correct and active for the date of service.
- Check ICD10data.com — codes shown in red are non-billable. The client must use a more specific child code.
- If the wrong code came from the EHR, check **System Maintenance → Conversions → Diagnosis** to see if a conversion mapping is causing the wrong code to be substituted.
- When the correct code is entered/fixed, the RCM will re-scrub automatically.

### "What's the difference between a denial and a rejection?"
- **Rejection**: Claim never made it into the payer's system. Structural error (e.g., wrong format, invalid code). No ICN. Fix the error and resubmit as a new claim. Shows in **Claim Status queue**.
- **Denial**: Payer received and adjudicated the claim but declined to pay (e.g., no auth, non-covered service, patient not eligible). Has an ICN. Can be appealed via corrected claim. May show in **Denied Procedures queue** if the EOB code is configured as a denial.

### "Why isn't my visit showing up in the RCM?"
1. Check the **Demographic Import Errors** queue — patient may have failed to import due to missing required fields (address, insurance, etc.).
2. Check **Charge Central** — if enabled, visits are held there until posted by a biller.
3. Check **Procedure Import Errors** — visit may have failed to post due to missing procedure code, place of service, or financial class.
4. Check the **Audit History** tab on the patient account (if the patient does exist) — shows the raw API payload received from the EHR and can confirm whether the visit was ever received.
5. If none of the above — the EHR may not have successfully sent the sync. This is an EHR-side investigation (🔧 EHR). Check the EHR billing tab for any sync errors.

### "Why is a claim stuck and not going out?"
- Check **Pre-Submission Errors** queue — the most common cause. The error message will state exactly what is missing (e.g., "Attending Provider NPI required").
- Fixing the underlying issue in System Maintenance (e.g., adding NPI to the provider record) will automatically release all visits blocked for that reason — no manual action needed per visit.
- Check **Insurance Visits on Hold** queue — billing may be held at the carrier level (waiting for enrollment), provider level, or visit level.
- Check that the **Send Claims** scheduled job is active and scheduled.
- ⚠️ Claims on hold placed by the EHR (not by the RCM) **cannot be released from Opus RCM**. The hold must be released from the EHR side. 🔧 EHR

### "A provider's modifier / place of service is wrong on the claim but looks right on the visit"
- Rules in Opus RCM apply at **billing time** only, not to the visit display. The visit will still show the pre-rule values.
- To see what rules were applied: go to the patient account → active visits → View Visit → **Rules Applied** tab.
- Check **System Maintenance → Rules** for any professional claim rules that could be modifying the field.
- Check the **HCFA configuration** on the insurance carrier in System Maintenance (carrier-level defaults that apply globally to that payer).
- Also check the Phicure portal to see the actual transmitted claim.

### "Patient information is wrong in RCM vs EHR"
- The EHR is the source of truth for patient demographics. Opus RCM syncs from the EHR; it does not override EHR data.
- Check **System Maintenance → Sending Facilities** for the "Automatically Apply Demographic Updates" setting. If off, updates from the EHR queue in the **Demographic Updates** queue for manual review.
- Check **Accounts → History → Audit History** to see the exact payload the EHR sent, including timestamps. This is the definitive answer to "what did the EHR actually send us?"
- Last-write-wins if a field is edited in both systems — the most recent update takes precedence. Avoid editing the same fields in both systems independently.
- 🔧 EHR If the EHR is consistently sending incorrect data, this is an EHR configuration issue.

### "Claim for eligibility / auth number is not coming through"
- **Authorization numbers** must be attached at the encounter level in the EHR (utilization management screen). They are passed to RCM as part of the visit sync.
- If the auth number is in the EHR but missing in the RCM: check Audit History to confirm it was sent; check the visit's "Update Visit" screen in RCM for the auth number field.
- 99.9% of the time, if the auth number is missing in RCM, it was not sent by the EHR.
- 🔧 EHR

### "Why do some payments show up as unapplied?"
- Payments from the EHR (e.g., copays taken at front desk) come into Opus RCM as **unapplied payments** — the EHR does not know which visit to apply them to.
- Imagine Pay payments from the patient portal are automatically applied via the **Receive Imagine Pay** scheduled job. If not yet applied, check that this job is running.
- Insurance remittance payments that can't be matched to a patient/visit drop to the **Unapplied Payments** queue. Most common cause: patient not found (subscriber ID mismatch, patient not in system). Also possible: procedure not found, insurance not found, would cause credit balance.
- Unapplied payments must be manually resolved by finding the correct patient account and applying the payment.

### "Why is there a credit balance on this account?"
- A credit balance means more money was received than was owed on a visit.
- Common cause: insurance paid, patient paid their portion, then insurance sent a second payment in error (or recouped and re-paid incorrectly).
- Resolution: create a **refund** in the Credit Balances queue. This creates an accounting memo in Opus RCM but does NOT print a check — the practice must cut the check through their accounting software.
- If paid via Imagine Pay (credit card or bank transfer): an Imagine Pay refund can be issued directly from the patient account (three-dot meatball menu on the payment → Imagine Pay Refund).
- ⚠️ Before issuing a refund, check whether the credit balance can be applied to another open visit on the same account instead.

---

## Sync Behavior: EHR ↔ RCM Reference

The following data categories sync from Opus EHR to Opus RCM:
- **Patients** (near real-time, ~55ms)
- **Insurance carriers** (sync on patient/visit update)
- **Providers** (sync from EHR)
- **Visits/encounters** (on manual sync or auto-sync depending on configuration)

The following do NOT sync from EHR to RCM and must be configured in RCM directly:
- Financial classes
- Adjustment codes / payment codes
- Fee schedules
- Rules and custom queues
- Scheduled jobs
- Institutional billing fields

🔧 A definitive field-by-field sync checklist is being created by the Imagine technical writing team (requested during Session 5 training). Until available, use the above categories as reference.

When investigating a data discrepancy, the recommended order is:
1. Check **Accounts → History → Audit History** in Opus RCM for the raw EHR payload.
2. Check **System Maintenance → Conversions** for any mapping that could alter the incoming value.
3. Check **Rules** and **HCFA configuration** on the insurance carrier.
4. If no RCM-side explanation found, escalate to EHR team (🔧 EHR) to investigate what was sent.

---

## Escalation Paths

| Tier | Owner | Handles |
|---|---|---|
| **Tier 1** | Opus Customer Support (John's team) | Basic break/fix: visit not showing, claim not going out, user access, queue questions, system maintenance edits |
| **Tier 2** | BH Rev RCM Operations (Johnny, Alyssa) | Complex billing questions, denial/appeal workflows, billing service clients |
| **Tier 3** | Imagine Support (Deanna + team) | Bugs, backend investigation, Phicure issues, scheduled job failures, audit log investigation |
| **Tier 4** | Imagine Engineering | Confirmed bugs requiring code fix, new feature requests |

**How to escalate to Imagine:** Submit a ticket via the **ITA ticketing system** (it.assistant.com). Include: title (not your job title), product = Peregrine, module, error description, screenshot, steps to reproduce, and client location. All Imagine staff see the ticket. Email and phone inquiries from Opus staff are acceptable but will be converted to tickets internally.

- 🔍 Investigations requiring Imagine backend access (API logs, database queries, Phicure portal) must go through Tier 3/Imagine.
- For Phicure-specific EDI issues: use the **Phicure Clearinghouse Request** ticket type in ITA — this routes directly to Phicure.
- For Imagine Pay admin portal access: request separately through Imagine (Janelle has access as of training).
- ⚠️ Before escalating to Imagine, Tier 1 should confirm: (1) patient/visit is not in a queue, (2) audit history has been checked, (3) conversions have been checked, (4) the issue can be replicated in the sandbox environment (or not) — this helps Imagine triage immediately.