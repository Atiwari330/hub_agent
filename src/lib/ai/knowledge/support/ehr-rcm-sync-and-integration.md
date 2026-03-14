# EHR ↔ RCM Sync & Integration

## Overview

The integration layer between Opus EHR and Opus RCM (Imagine/Peregrine). This covers the handshake/token mechanism, what data syncs bidirectionally, GUID linking, Charge Central, conversions/code mapping, file import log, and common sync issues.

Opus RCM connects to the EHR via a real-time API. The two systems maintain **separate databases**. From the client's perspective they are one product; internally they are distinct systems built by different teams (Imagine Software for RCM, Hector's team for EHR). Many support tickets involve data that is wrong or missing on the **EHR side** but only surfaces as an error or missing record in the **RCM**. Always identify which system is the source of truth for the field in question before directing the client to fix anything.

---

## Handshake / Token Mechanism

- The EHR and RCM are linked by a **one-time environment-level handshake** (token/key pair) that is configured once at initial setup and persists permanently per client environment.
- 🔧 This handshake is set during implementation by the Imagine and EHR engineering teams. End users and Tier 1 support cannot configure or reset it.
- Each client has its own unique URL following the format: `{clientname}opusrcm.imagineparagraph.com`
- There is **no in-product navigation button** from the RCM back to the EHR tenant (or vice versa, except a button may exist in the EHR; confirm with EHR team). Users must navigate to each URL separately.
- In the sandbox environment, the connection is identified by an API key like `dev-FUNC-billing`; the specific EHR environment a sandbox dataset is linked to can be confirmed with Rod or Marilyn.
- Each client environment is fully isolated — a user with access to one client's RCM cannot see another client's data unless explicitly given access to multiple datasets.

---

## Bidirectional Sync

### What Syncs EHR → RCM

The four major categories of data that flow from EHR to RCM are:

- **Patients / Demographics** — synced when a patient is created or updated in EHR. Includes name, DOB, address, guarantor information.
- **Insurance carriers** — insurance plan information attached to a patient account.
- **Providers** — provider records (name, NPI, taxonomy, etc.).
- **Visits / Encounters / Procedures** — encounter records with procedure codes, diagnosis codes, place of service, authorization numbers (from utilization management), and other clinical billing fields.

**Sync timing:**
- Patient records sync nearly instantly after creation in EHR.
- Visits sync when a user manually initiates a sync from the EHR billing tab (or, in some configurations, automatically as encounters are signed/finalized).
- ⚠️ Sync time is **volume-dependent**. A single visit syncs almost immediately. A large batch of visits (e.g., 50–100+) takes longer because the RCM processes them sequentially on a "conveyor belt" model. There is no guaranteed upper time limit for large batch syncs. When a client asks why a sync is "taking 10 minutes," this is the explanation — reassure them it is processing and not lost.
- 🔧 EHR A known historical bug caused the EHR to send hundreds of requests within a span of a few hundred milliseconds, overwhelming the RCM and causing it to drop records. A fix was deployed on the EHR side (500ms spacing between requests). Duplicate account issues at US2 were caused by this bug; if similar issues arise, escalate to both EHR engineering and Imagine.

**Authorization numbers:**
- Authorization numbers attached at the encounter/referral level in the EHR (via the utilization management screen) are passed through as part of the visit sync payload.
- 🎫 If an auth number is missing on a claim in the RCM, the first check is always whether it is attached to the encounter in the EHR. 99.9% of the time, auth number issues trace back to the field not being populated in the EHR.

**What the EHR CANNOT do:**
- The EHR **cannot delete** visits, procedures, or patient accounts in the RCM. It can only add new records or update existing ones. If a visit exists in the RCM, it will remain there even if the corresponding encounter is deleted or voided in the EHR.

### What Syncs RCM → EHR

- When **any change is made to an account in the RCM** (visit update, demographics change, insurance update, etc.), the RCM sends the **full account payload** back to the EHR — every visit, every demographic, every insurance record on that account — so the EHR can stay in sync even if it missed an earlier message.
- Whether the EHR actually processes and displays these updates is **determined by Hector's team / EHR engineering**, not by Imagine. The RCM always sends the data; the EHR chooses what to do with it.
- When the RCM **cannot accept** a sync message (e.g., insurance is inactive, patient is archived, visit has been merged), it sends back a detailed error message to the EHR. The EHR should display some or all of this error text to the user. If the EHR just shows a generic "RCM sync error," that is an EHR-side display limitation, not an RCM failure.

**"Last write wins" behavior:**
- ⚠️ If the same field is edited in **both systems in close sequence**, there is a risk of a "data volleyball" loop where one system's update overwrites the other's. The system uses last-write-wins logic. Best practice: pick one system as the authoritative source for any given field and train clients accordingly.
  - For **professional claims**: make corrections in the EHR; they will sync to RCM.
  - For **institutional claims**: corrections typically need to be made in the RCM because the EHR does not have institutional billing fields.

**Fields that do NOT sync (one-directional or static):**
- **Financial class** — defined and managed entirely within the RCM. The EHR does not send or receive financial class data.
- RCM-internal configurations (fee schedules, payment codes, rules, scheduled jobs, etc.) have no EHR counterpart.

---

## GUID Linking

- Every patient, visit, and procedure record shared between EHR and RCM is linked by a **unique identifier (GUID/external account number)** — a long alphanumeric string that is invisible to users but used by the system to know which EHR record corresponds to which RCM record.
- When the EHR sends a patient update, the RCM uses this identifier to determine whether to **create a new account** or **update an existing one**. It will never create a duplicate based solely on a GUID match.
- For **duplicate detection**, the RCM also checks name, date of birth, and address. If a new patient request appears to match an existing account, the RCM holds it in the **Demographic Import Errors** queue with a "duplicate patient found" flag rather than creating two records.
- 🎫 If a client reports that a patient "disappeared" or "was replaced," check whether a GUID conflict or demographic mismatch caused the incoming record to be held in Demographic Import Errors.

---

## Charge Central

Charge Central is a **manual gating mechanism** that intercepts visits coming from the EHR before they are posted to the patient account in the RCM.

**How it works:**
- When Charge Central is **ON** for a sending facility (data set), every visit/encounter that syncs from the EHR lands in the **Charge Central queue** instead of automatically posting to the patient account. The visit **does not exist on the patient account** until a biller manually reviews and posts it.
- When Charge Central is **OFF**, visits flow directly through to the patient account and begin scrubbing for errors automatically.
- Charge Central is **binary (all-or-nothing)** by default: either every incoming visit goes through Charge Central, or none do. A conditional/criteria-based Charge Central is in development but not yet released.

**Configuration:**
- Charge Central is configured **per sending facility (data set)**, not globally across a tenant.
- 🔧 To enable/disable: **System Maintenance → Sending Facilities → Edit → Charge Central toggle.**
- ⚠️ **Also notify the EHR engineering team** (Marilyn/Hector) when Charge Central is enabled or disabled — the EHR has its own configuration related to this. Per Deanna: "You also have to tell your engineering team that Charge Central is enabled, because I think they have configurations on your side as well."
- Per Alyssa: "I've been telling Marilyn and she either switches it on or gives me the okay to switch it on." Confirm with Marilyn before enabling Charge Central for a client.

**Who uses Charge Central:**
- Typically larger practices with dedicated billing teams who do not trust clinical staff to code correctly in the EHR.
- Owner-operator clinicians who also do their own billing typically do **not** use Charge Central.
- Approximately 75% of Opus clients currently use Charge Central.

**Working Charge Central:**
- From the Charge Central queue, billers can review the incoming coding, make any changes they need (diagnosis, procedure code, modifiers, units, etc.), and **post** the visit. Posting is what moves the visit to the patient account.
- Mass select + post is available for visits the biller wants to pass through without review.
- ⚠️ **Hard delete is available in Charge Central** — one of the very few places in the system that allows deletion. Deleted charges are permanently gone. If a deleted charge is resynced from the EHR, it will re-enter Charge Central.
- 🎫 **Most common support trigger for Charge Central:** Client says "I synced my patients but their visits aren't showing up in the RCM." **First check:** Is Charge Central turned on? If yes, the visits are in the Charge Central queue waiting for review. This accounts for the vast majority of "visit not found" tickets.

**Biller Review Lock (upcoming feature):**
- In development: Once a biller has reviewed and posted a visit in Charge Central, the EHR clinical team will be blocked from further updating that visit. An error message will display: "This has been approved/reviewed by the billing team already. Please contact them if you want to make changes."

---

## Conversions / Code Mapping

Conversions live in **System Maintenance → Conversions** and define how codes sent from the EHR are translated into codes recognized by the RCM.

**What needs to be mapped:**
- **Locations** — EHR location codes must be mapped to RCM location records. If a location code comes over from the EHR that doesn't match any conversion, visits attached to that location will fail with a Procedure Import Error.
- **Financial Classes** — If the EHR sends a financial class code the RCM doesn't recognize (e.g., `7654`), it will not be linked and the visit may drop to a queue.
- **Insurance carriers** — EHR payer codes must be linked to RCM insurance carrier records.
- **Providers** — EHR provider identifiers must be linked to RCM provider records.
- **Diagnosis codes (ICD-10)** — These are sufficiently standardized that the RCM will **auto-link** them without manual intervention, as long as the same code exists in both systems. Unmapped or non-standard diagnosis codes received from EHR will appear in the Conversions → Diagnosis Codes list. Visits using unrecognized diagnosis codes will drop to Procedure Import Errors without a diagnosis.
- **Procedure codes (CPT)** — Must be present in the RCM. If a procedure code comes from the EHR that doesn't exist in the RCM, the visit drops to Procedure Import Errors.

**Key behaviors:**
- If a conversion is not set up, the RCM does not guess. The visit will be held in an error queue until the mapping is created.
- ⚠️ When a mapping is added or corrected, the RCM will automatically re-process all visits that were previously blocked by that missing mapping — across all patients in the system. Users don't need to manually re-trigger each visit.
- 🎫 A common root cause for Procedure Import Errors is a code that exists in the EHR but hasn't been configured in the RCM, or whose conversion record isn't linked.

---

## File Import Log

The File Import Log (also called **Audit History** at the account level) is the primary tool for investigating EHR→RCM sync discrepancies.

### System-Level File Import

- Located in the main navigation (not inside a patient account).
- Shows **every API call ever received from the EHR** in raw text format.
- Each record can be downloaded and opened in a text editor (e.g., Notepad) to see the exact JSON/text payload the EHR sent.
- ⚠️ This log can be very large and difficult to search. Use a specific identifier (MRN, external account number, or unusual last name) to filter results. Common names are hard to isolate.
- Deanna's note: "I don't tell clients much because it can be frustrating anyway" — this tool is primarily for Opus/Imagine support investigation, not client self-service.

### Account-Level Audit History

- Located inside a patient account: **History → Audit History**.
- Shows every EHR sync event for that specific account with timestamp, visit number, and action type.
- Introduced approximately 2 months before December 2025 (roughly October 2025). Events before that date are not captured here.
- Each entry can be downloaded individually to view the raw payload.
- This is the **first place to look** when a client reports a discrepancy between what's in the EHR and what's in the RCM (e.g., "insurance shows Blue Cross in EHR but Aetna in RCM"). The audit history shows exactly what was sent to the RCM verbatim.
- Useful for diagnosing timing issues: timestamps are captured to the millisecond, so if the EHR sent two updates within 36 seconds, both are visible.

**Support workflow using File Import Log:**
1. Client reports a data discrepancy between EHR and RCM.
2. Go to the patient account → History → Audit History.
3. Download and open the relevant event file.
4. Confirm what the EHR actually sent (source of truth for the sync).
5. If what the EHR sent matches what's in the RCM → the issue is on the EHR side (wrong value entered in EHR, EHR configuration bug, or a rule in the EHR).
6. If what the EHR sent does NOT match what's in the RCM → check RCM Conversions, Rules, and HCFA configuration to see if something is transforming the value.
7. 🔍 If neither explains it → escalate to Imagine support for backend log investigation.

---

## EHR Holds Affecting RCM

Holds can be applied to visits from **either system**, but they behave very differently:

### EHR-Initiated Holds

- The EHR can send a **hold flag** with a visit that overrides anything in the RCM.
- ⚠️ **The RCM cannot release an EHR-initiated hold.** There is no button or mechanism in the RCM to unhold a visit that has been held by the EHR. The hold must be released from the EHR side.
- 🔧 EHR These visits appear in the **Insurance Visits on Hold** queue but are distinguishable because they cannot be released by the user from within the RCM.
- 🎫 If a client says "this visit is on hold and I can't release it no matter what I click," this is almost certainly an EHR-initiated hold. Escalate to the EHR team (Hector/Marilyn) to release it.
- Per Deanna (Session 5): Marilyn confirmed that the EHR team is no longer using that specific type of hold going forward, so new occurrences should be rare — but previously held visits from US2 were tied to this mechanism.

### RCM-Initiated Holds

Holds within the RCM can be applied at multiple levels:
- **Visit level** — from within the patient account, Edit Visit → Hold Insurance Billing or Hold Patient Billing.
- **Patient account level** — defaults set in the patient account hold all billing for that patient.
- **Insurance carrier level** — System Maintenance → Insurance Carriers → Hold Billing checkbox. Useful when waiting for enrollment/credentialing to complete, or when a clearinghouse is down (e.g., Change Healthcare outage scenario). Unchecking this releases all held visits for that carrier instantly.
- **Procedure level** — individual procedures within a visit can be held separately (shown as yellow triangle in queues vs. the whole visit being held).

All RCM-initiated holds are visible and releasable by the user within the RCM.

**Automatic hold — automatic payments:**
- When a patient has automatic payments scheduled, the system automatically holds paper statement delivery to avoid double-billing. This shows in the **Statements on Hold** queue with a note about automatic payments.

---

## Common Issues in Support Tickets

### "Patient / visit isn't showing in the RCM"

**Triage order:**
1. **Is Charge Central enabled?** If yes — the visit is likely in the Charge Central queue, not on the patient account. This is the #1 cause of "where is my visit" tickets.
2. **Is the patient in Demographic Import Errors?** If the patient was sent from EHR but required fields (address, primary insurance, guarantor info, etc.) were missing, the patient record is held here and has no account in the RCM until resolved.
3. **Is the visit in Procedure Import Errors?** If the patient exists but the visit has missing or unmapped fields (financial class, procedure code, location, referring provider), the visit is held here and does not appear on the patient account.
4. **Did the EHR actually send the record?** Check the File Import Log / Account Audit History to confirm the sync was even attempted. If no record exists in the log, the EHR did not send it — this is an EHR support issue.
5. **Is the visit in the Non-Post queue?** Rare for Opus EHR workflows (more common in hospital-type flows where charges arrive before demographics), but possible. The queue will auto-clear when the matching patient record arrives.
6. 🔍 If not in any queue and not in audit history, escalate to Imagine. There may have been a backend processing failure.

### "Data synced but values are wrong (e.g., wrong insurance, wrong diagnosis code)"

**Triage order:**
1. Go to **Account → History → Audit History** and download the relevant sync event. Confirm what the EHR actually sent.
2. If the EHR sent the wrong value → 🔧 EHR issue. The EHR team (Hector/Marilyn) or the clinical user needs to correct it in the EHR and re-sync.
3. If the EHR sent the correct value but the RCM shows something different → check **Conversions** (is there a conversion mapping transforming the code?) and **Rules** (is there a rule altering the field at billing time?). Also check **HCFA/insurance carrier configuration** in System Maintenance.
4. If a rule was applied: rules only execute at **billing time** — they do not change what's visible on the visit itself. Use **View Visit → Rules Applied** to see which rules affected a visit.
5. 🔍 If conversions and rules don't explain the discrepancy → escalate to Imagine for backend log review.

### "Sync is failing / RCM sync error message"

- When the RCM cannot process an incoming EHR message, it returns a detailed error message to the EHR. The EHR should display this to the user. If the EHR only shows a generic error, instruct the client to check the relevant error queue in the RCM (Demographic Import Errors or Procedure Import Errors are the most common).
- 🎫 Reported scenario (Session 5 / Jonni): Client had two primary insurance records in the EHR (one with an end date, one with an effective date). RCM interpreted both as active and threw a sync error. Resolution: client removed the new insurance from EHR, sync cleared on its own, then re-added it. Wait for sync to process before concluding something is broken.
- ⚠️ If a patient has been **archived** in the RCM and the EHR attempts to sync them again, the EHR will receive a sync error. The RCM has no way to unarchive; the EHR would create a new patient record.

### "Visit is on hold and can't be released"

- First, check whether the hold is EHR-initiated (see **EHR Holds** section above). If yes → escalate to EHR team.
- If RCM-initiated, check: visit-level hold, patient account-level default, or carrier-level hold in System Maintenance.

### "Visits merged and now getting a sync error"

- If a biller **merges visits** in the RCM (one of the few destructive/irreversible actions), the merged-away visit no longer exists. If the EHR subsequently tries to re-sync that visit, it will receive a sync error because the visit ID is gone.
- ⚠️ There is **no unmerge** capability. The merge is permanent.
- The merge event is recorded in the account notes (searchable by typing "merge" in the notes filter).

### "Patient is a duplicate / two accounts for the same patient"

- Known bug (now patched): EHR was sending hundreds of requests within a few hundred milliseconds. The RCM processed some and dropped others, sometimes creating partial duplicate records. This affected US2 specifically. The fix (500ms spacing per request) was deployed on the EHR side.
- If duplicates exist: a list must be generated by the Imagine team and resolved by the client (merge or delete from Demographic Import Errors queue if not yet committed; otherwise manual review).
- 🔍 Active duplicate investigation requires Imagine backend access.

### "Authorization number is missing on the claim"

1. Check the utilization management / referral screen in the EHR — is the auth number actually attached to the encounter?
2. If yes in EHR → check the RCM visit (Update Visit) for the auth number field.
3. If present in both → check if a rule is suppressing it on the outgoing claim.
4. If present in RCM but not appearing on the claim → escalate to Imagine to check Phicure transmission.
5. ⚠️ 99.9% of the time: auth number exists in EHR but was not attached at the encounter level, or did not transfer because of a missing conversion link.

### "Claim is stuck / not going out"

**Pre-submission errors are the most common cause.** Triage:
1. Check **Pre-Submission Errors queue** — this is the last hard gate before a claim is transmitted. Errors must be resolved before the claim will leave the system.
2. Check if the visit is **on hold** (visit-level, carrier-level, or patient-level).
3. Check if the claim is in **Outgoing Insurance Claims** queue — it may just be waiting for the next scheduled claims job to run.
4. Confirm the **Send Claims scheduled job** is active and set to run at an appropriate time.
5. ⚠️ Common pre-submission error triggers that trace back to EHR or RCM configuration:
   - Missing provider NPI (check System Maintenance → Providers)
   - Missing referring provider NPI
   - Missing diagnosis code (usually a conversion/mapping issue)
   - Missing place of service
   - Missing attending provider

---

## Additional Integration Reference

### Data Sets vs. Locations

- **Data set** (RCM term) = a fully segregated grouping of data, equivalent to a separate legal entity with its own Tax ID / EIN. Different data sets appear as separate items in the top-left dropdown in the RCM.
- **Location** (RCM term, maps to EHR "location") = a physical office address within the same legal entity. Multiple locations appear in **System Maintenance → Locations**, not as separate data sets.
- 🔧 Data sets are created manually in **Data Set Management** in the RCM and then linked back to the corresponding EHR environment by Marilyn, Rod, and Hector's team. End users can create data sets but the EHR linkage requires engineering involvement.
- ⚠️ If a client has multiple EHR locations under the same Tax ID, those should all appear as **Locations** within a single RCM data set, not as separate data sets.

### Patient Archiving

- Archiving a patient in the RCM hides them from all account views, removes them from queues, and prevents new visits from being added.
- **Archive is irreversible** — there is no unarchive function.
- 🔧 EHR Archiving in RCM does NOT affect the EHR patient profile. If the EHR tries to sync that patient again after archiving, it will receive a sync error and the EHR will create a new patient record in the RCM.

### Demographic Update Queue

- In **System Maintenance → Sending Facilities**, there is an option to **automatically apply demographic updates** (ON) or hold them for manual review (OFF).
- When OFF, every demographic change from the EHR lands in the **Demographic Updates queue** for a user to accept or reject field by field.
- Use case: radiology/hospital clients who receive messy data entry from hospital systems; behavioral health clients who want tight control over patient demographics.
- Users can accept individual field changes (e.g., accept email update but reject name change) before applying.

### Escalation Path for EHR↔RCM Issues

| Issue Type | Who Resolves |
|---|---|
| Value is wrong in RCM and EHR Audit History shows it came over wrong from EHR | 🔧 EHR team (Hector/Marilyn) |
| Value is wrong in RCM but Audit History shows EHR sent the correct value | Check Conversions/Rules in RCM; if unexplained → Imagine support ticket |
| Visit missing in RCM, not in any queue, not in Audit History | 🔧 EHR team — EHR did not send it |
| EHR-initiated hold cannot be released | 🔧 EHR team (Marilyn) |
| Sync error message appearing in EHR UI | Check RCM error queues first; if not resolvable → Imagine support ticket |
| Duplicate accounts | 🔍 Imagine backend investigation required |
| Charge Central configuration | System Maintenance + notify EHR team |
| Conversion/code mapping missing | System Maintenance → Conversions (client or Opus configurable) |

**Submitting issues to Imagine:** Use the IT Assistant ticketing system at `itassistant.com`. Select product "Peregrine." Include: title, module where the error occurred, screenshots, steps to reproduce, and client location. For Phicure/clearinghouse issues, there is a separate **FICare clearinghouse request** ticket type that routes directly to Phicure without going through Imagine support first.