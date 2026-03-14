# Utilization Review (UR) & Authorization Tracking

## Overview

The Utilization Review (UR) tab in Opus EHR tracks insurance authorizations for approved services. Authorization numbers entered in UR automatically flow onto corresponding encounters within the approval window. This is a critical feature for behavioral health billing where pre-authorizations are required for reimbursement.

- The UR tab is also referred to as "utilization review," "UR," or "pre-auth" interchangeably by staff and customers.
- The UR tab connects closely to both the **Billing tab** and the **patient calendar** — data entered here surfaces in both places.
- **Not all customers use the UR tab.** Pure outpatient organizations with no insurance authorization requirements may have no use for it. UR is most relevant for: (1) customers billing per diem / level of care, and (2) customers who have patients with insurance pre-authorization numbers.
- EAPs (Employee Assistance Programs) are a particularly common use case — these almost always require an authorization number on the encounter.

---

## Two Distinct Use Cases

Understanding which use case applies to a customer is the first step in any UR support interaction.

### Use Case 1: Scheduling Level of Care (Inpatient / Per Diem)
- Customer has patients in levels of care (e.g., Detox, PHP, IOP) that are billed per diem (one rate per day, not per session).
- UR is the **recommended and easiest workflow** for scheduling days within a level of care in Opus.
- Units in this context = **days**. 1 unit = 1 approved day.
- Selecting days in the UR review directly schedules the patient for level of care on those days.

### Use Case 2: Tracking Authorization Numbers for Outpatient Services
- Customer has outpatient patients with insurance-issued authorization numbers tied to specific CPT/service codes.
- UR allows the authorization number to be entered once and then auto-populate on all relevant encounters within the approval date range.
- This eliminates manual entry of auth numbers on each individual claim.

---

## Creating a New UR Review — Workflow

Accessed from the **UR tab** (left-hand navigation, also called "Utilization").

1. Click **New Review** in the top-right corner.
2. **Select the patient** — once selected, any insurance on file in the patient's chart **auto-populates** in the insurance field.
3. **Review Date** = today's date (current authorization).
4. **Next Review Date** = optional, used to flag when re-authorization needs to occur (e.g., 30 days out).
5. **Status** = optional field.
6. **⚠️ Only fields marked with a red star are required.** All other fields are optional.
7. **Service Type** — this is the critical fork. Choose either **Level of Care** or **Services**. Behavior differs significantly between the two (see sections below).

---

## UR for Level-of-Care / Inpatient (Per Diem) Billing

- Select **Service Type: Level of Care**.
- Choose the specific **level of care** (e.g., Detox, IOP, PHP).
- Enter the **number of approved units** (units = days approved by insurance).
  - The approved unit count displays at the top of the review.
  - As days are selected/scheduled, the remaining unit count decrements automatically.
- **Scheduling days**: Click directly on calendar days within the UR review to assign the patient to that level of care. This is described as the easiest way to schedule level of care days in Opus.
  - Days can also be assigned from the patient's calendar (three-dot menu on any date → select level of care), but the UR interface is preferred for bulk day assignment.
- **Provider** and **Place of Service** can be added directly in the UR review. Place of service for level of care is typically "Office," not telehealth.
- Once saved, scheduled level of care days will appear in the **patient calendar** and on the **main Schedule tab**.
- The "utilization" sub-tab within the patient calendar shows a summary of what has already been scheduled for that review.

### ⚠️ Level of Care Must Be Configured First
Before a level of care can be scheduled via UR, it must:
  1. Be created in **Settings → Level of Care** (name, billing code, revenue code, HCPC code).
  2. Be marked as **billable** in level of care settings.
  3. Be **turned on in Location Settings** for the relevant location — if not turned on per location, it will not appear as a scheduling option.

### ⚠️ Unit Decrement Behavior (Level of Care vs. Services)
- For **level of care**: scheduling a day **does reduce** the remaining approved unit count in the UR review.
- For **services**: the unit count field does **not** auto-decrement when services are scheduled. The approval range (date window) is the governing field for services UR, not the unit count.

---

## UR for Outpatient Services (Authorization Number Tracking)

- Select **Service Type: Services**.
- **Multiple services can be selected** in a single UR review (e.g., 90791, 90832, 90837).
- When "Services" is selected, the day-scheduling calendar on the right side **grays out** — this is expected behavior, since outpatient services are time-based, not day-based.
- Enter the **authorization number** issued by the insurance company.
- Enter the **approval range** (start date and end date — e.g., "approved through March 31st").
- **Number of units** field: Can be entered, but **does not auto-decrement** when services are scheduled. The approval range/date window is what drives auto-population onto encounters.
- Once saved: any time the patient is scheduled for one of the listed services within the approval range, **the authorization number automatically populates on the encounter** (visible in the authorization number field on the Edit Encounter screen in the Billing tab).

### How the Auth Number Gets to the Encounter
- The authorization number flows to the encounter automatically if:
  1. The service on the encounter matches a service listed in the UR review, **and**
  2. The encounter date falls within the UR approval range (start and end date).
- This is a set-it-and-forget-it workflow — users enter the auth once in UR and it flows to all qualifying encounters without additional manual steps.
- The authorization number field is also visible and editable directly on the **Edit Encounter** screen under the Billing tab.

---

## Understanding "Units" — Critical Disambiguation

⚠️ **"Units" is used to mean two completely different things in Opus. This is a frequent source of confusion for users and internal staff.**

| Term | Meaning | Where It Applies |
|---|---|---|
| **Billing units** | How many service units are billed (e.g., 4 units for a 60-min session billed in 15-min increments) | Service/CPT code settings, encounter CPT code editor |
| **Utilization/authorization units** | How many sessions or days insurance has approved | UR review (level of care or services) |

- These two concepts **do not connect** in Opus. Scheduling a service with 4 billing units does **not** pull 4 units from the UR authorization unit count.
- For level of care: 1 authorization unit = 1 day. Scheduling one day reduces the count by 1, regardless of how many group sessions or billable services occur that day.
- Definition from SME (Alyssa, billing context): "For utilization, [units are] the amount of authorization or approvals that the agency has from the insurance company... this is all about how many units of service that the insurance company authorizes you to provide that they'll pay for." This is distinct from billing units, which are determined by procedure code, payer rules, and session duration.

---

## Billable Group Session Hours for Level of Care

This feature enforces a minimum number of group session hours before a level of care encounter is allowed to flow to the billing tab.

- Configured per level of care in **Settings → Level of Care → Billable Group Session Hours Required for Billing**.
- Example: If IOP requires 3 billable group session hours per day, a patient scheduled for IOP who only attends 2 hours of group that day will **not** generate a billing tab encounter for IOP — the encounter is suppressed until the requirement is met.
- Once the required group session hours are met, the level of care encounter flows to the billing tab and can be sent to RCM.
- **The group sessions counted must be marked as billable services.** Non-billable group sessions do not count toward the hour requirement (confirmed via a separate bug discovery during training).
- The billing tab encounter for level of care will display a counter: e.g., "Billable group session hours completed: 0 out of 3."

### ⚠️ Known Bug (as of training)
- The billable group session hours counter was **not calculating correctly** during the training session demo (also observed in another tenant the week prior). This was flagged for a Linear engineering task. If a customer reports that group session hours are not incrementing correctly on a level of care encounter, this is a known issue — escalate to engineering.

### Non-Billable Groups and Per Diem Billing
- Some IOP/PHP customers run 2–3 non-billable group sessions per day that roll up into a single per diem (level of care) encounter.
- Those group sessions are marked **non-billable** in service settings, so they do not individually flow to billing or RCM.
- Only the level of care encounter flows to RCM. This is not "bundling" or "merging" in a technical sense — encounters remain separate in the EHR, but only the level of care encounter is transmitted to the payer.
- **Opus does not have a bundling or merging feature.** Customers who request this should be informed that the workaround is non-billable group services + a level of care encounter.

---

## Duration Automation for Billing Units (Related Feature)

Not strictly UR, but frequently discussed in the same context because it affects how units appear on encounters.

- 🔧 **Must be enabled by the engineering team** — this is a backend configuration per customer, not a toggle users can set themselves.
- When enabled: units on an encounter auto-calculate based on appointment duration relative to a configured default duration per service.
  - Example: Default duration = 30 min → 60-min appointment = 2 units, 90-min = 3 units.
- Without duration automation: unit count always defaults to **1 unit** unless manually updated by a user.
- This is configured **per service** — some services for the same customer may have automation, others may not.
- 🎫 Common ticket trigger: providers schedule a 60-min session but billing shows 1 unit. Root cause is usually duration automation not being enabled or the default duration not being set for that service. Escalate configuration requests to engineering.

---

## Where UR Data Surfaces (Summary)

| Data | Where It Appears |
|---|---|
| Level of care days scheduled via UR | Patient calendar, main Schedule tab |
| Remaining approved units (level of care) | UR review, patient calendar (as remaining units counter) |
| Authorization number (services UR) | Encounter record (authorization number field) in Billing tab |
| UR review list | UR tab (left nav) — shows all reviews created for patients |

---

## Level of Care Settings — Required Prerequisites

Before UR for level of care will work correctly end-to-end:

1. **Create the level of care in Settings** — requires: name, billing code, revenue code (optional), HCPC code (optional), billable = yes.
2. **Enable the level of care per location** — go to Location Settings → enable the level of care for the relevant location.
3. If the level of care is **not marked billable**, it will not generate an encounter on the billing tab even if scheduled.
4. If the level of care is **not enabled in location settings**, it will not appear as an option when scheduling.

---

## Common Issues in Support Tickets

### 🎫 "Authorization number not appearing on claims"
- Check the UR tab — verify the authorization was entered with the correct CPT code(s) and date range.
- Confirm the encounter date falls within the authorization's approval range (start and end date).
- Confirm the service on the encounter exactly matches the service(s) listed in the UR review.
- Check the encounter record directly (Billing tab → three dots → Edit Encounter → authorization number field) — the number may be present on the encounter but not visible in the customer's usual view.

### 🎫 "Units tracking seems wrong"
- First, clarify which type of units the user is referring to: **billing units** (CPT/service level) or **authorization/utilization units** (UR review).
- If billing units: check if duration automation is enabled for that service. Without it, units default to 1 unless manually changed. 🔧 Engineering must enable duration automation.
- If utilization units (level of care): confirm days are being scheduled through the UR review or patient calendar — both methods should decrement the unit count.
- If utilization units (services): units on a services UR **do not auto-decrement** — this is expected behavior. The approval range is the operative control for services.

### 🎫 "Authorization expired but services continue"
- The UR tab must be updated with a new authorization number and new approval range when renewals are obtained.
- Expired authorization entries will not flow onto new encounters — the encounter's authorization number field will be blank.
- If the patient continues to be seen after authorization expiry without a UR update, claims will go out without authorization numbers and will likely be denied by the payer.

### 🎫 "Level of care encounter not showing on billing tab"
- Verify the level of care is marked as **billable** in settings.
- If the level of care has a **billable group session hours** requirement configured, confirm the patient met the minimum hours that day. If not, the encounter will be suppressed from billing.
- Confirm the level of care is **enabled in location settings** for the relevant location.
- ⚠️ Also check for the known bug where group session hour counting is not calculating correctly — if this appears to be the issue, escalate to engineering.

### 🎫 "User says they can't find the UR tab or the level of care option"
- UR is a left-nav tab labeled "Utilization." Customers may call it "UR," "utilization," or "authorization tracking."
- Level of care scheduling options only appear if the level of care has been turned on in Location Settings for that location.

### 🎫 "Customer asking about bundling or merging encounters"
- Opus does **not** have bundling or merging functionality. This is a commonly requested feature that does not currently exist.
- The workaround for per diem customers is: non-billable group sessions (not sent to RCM) + a billable level of care encounter (sent to RCM). The group sessions support documentation/compliance; only the level of care code goes to the payer.

---

## Escalation Notes

- 🔧 **Duration automation** (auto-calculating billing units based on appointment length) requires engineering configuration — cannot be self-served by the customer or support.
- 🔧 If a customer's level of care encounters are not flowing correctly to billing after all settings are confirmed correct, escalate to engineering — this may be a configuration issue at the tenant level.
- ⚠️ The **billable group session hours counter bug** (not incrementing correctly) was an open engineering issue as of the training date. Confirm current status before communicating to customers — check Linear for the relevant task.