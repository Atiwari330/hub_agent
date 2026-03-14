# Medications & MARS (Medication Administration Record)

## Overview

Opus EHR includes medication management capabilities including e-prescribing (via DoseSpot), medication tracking, and the MARS (Medication Administration Record System) for facilities that manage medication administration.

- All medications are entered through the **patient's chart** (Medications tab) and that information can then flow over to the **MARS tab**.
- The MARS tab is primarily used by **inpatient facilities**. Outpatient-only organizations typically do not use it.
- **EMAR** is a separate, third-party platform that Opus integrates with for organizations that need more robust medication administration than what the native MARS tab provides. When EMAR is enabled, it completely replaces MARS and medications functionality within the EHR. See the EMAR vs. MARS section below.
- 🔧 **DoseSpot** is the third-party provider that powers the E-Prescribe tab in Opus. It is an integration, not a native feature.

---

## Scheduled vs. PRN Medications

- **Scheduled medications**: Administered at set times according to a provider's order. They require a **frequency** (times per day) and specific **administration times**.
- **PRN medications** (also called "as-needed" medications): Administered as-needed based on clinical judgment. They do **not** have a frequency or scheduled time, but they still have a start and end date/time that governs when they appear as active.

### Active/Inactive Status Based on Date Range

- Every medication (both scheduled and PRN) has a **start date/time** and either an **end date/time** or an **"Until Discharge"** option.
- A medication will appear as **inactive** if the current time has not yet reached its start date/time.
- A medication will become **active** once the start date/time is reached and remain active until the end date/time or patient discharge.
- ⚠️ If a medication was just added and shows as **inactive**, this is expected behavior if the start time is set in the future — it is not a bug.
- The date/time logic is based on the **time zone of the location** (not the user's device time).
- **"Until Discharge"** means the medication continues to appear on the MARS tab indefinitely until the patient's chart is marked as discharged.

---

## MARS Administration Tab

### Navigation and Views

- The MARS tab is accessible from the **left-hand navigation** and is a separate tab from the patient chart.
- Users can find a specific patient by using the **filter/search** on the left-hand side of the MARS tab.
- The MARS tab offers two views:
  - **Scheduler view** (default): Displays a **week-at-a-time** view. Whatever date is selected, the system always shows that full week (Sunday–Saturday). Users cannot narrow to a single day in this view.
  - **List view**: Accessible via the "List" toggle at the top. Allows sorting by most recent entries, filtering by date range (including single-day), patient, status, medication type, and more. Filters can be stacked.
- Users can toggle to see only **their assigned patients** rather than all patients.

### Documenting Administration Events

- To mark a medication as given, the staff member clicks on the medication entry, then clicks **Edit**.
- They can **adjust the date and time** of administration (e.g., scheduled for 8:00pm but given at 8:04pm).
- They mark the medication as either **Given** or **Not Given**.
- The system prompts for a **staff signature** — users can click "Use My Signature" if their signature has been saved on file.
- ⚠️ **Patient signature**: Some organizations require a patient signature at the time of administration. If enabled, a signature box appears for the patient to sign directly.
- An optional **notes field** is available for each administration event.

### Color Coding

- 🟢 **Green**: Medication was marked as **given**.
- 🟡 **Yellow (Pending)**: Medication has not yet been updated — administration status is unknown.
- 🔴 **Red**: Medication was marked as **not given**.

### PRN Medication Administration in MARS

- PRN medications do not appear on the MARS scheduler automatically (since they have no scheduled time).
- To document a PRN administration, staff click the **"Add PRN Medication"** button at the top of the MARS tab.
- The dropdown in this modal only shows **medications that have been added to that patient's chart** as PRN. If a medication is not listed, it needs to be added to the patient chart first.
- Once created, the PRN entry appears as a **new entry** on the MAR with the time it was administered.

### One-Way Data Flow

- ⚠️ Data flows from **Medications (patient chart) → MARS only**. You cannot create or modify a medication from within the MARS tab and have it sync back to the patient's Medications tab. The Medications tab is where setup happens; the MARS tab is where daily documentation happens.

---

## EMAR vs. MARS

- **EMAR** is the electronic medication administration record — when enabled, the Medications tab, MARS tab, and E-Prescribe tab in the EHR are **all disabled**. All medication management is handled in EMAR.
- This is **by design and not a bug**.
- ⚠️ The MARS tab in the EHR does **not** connect to EMAR. They are entirely separate systems. Do not suggest troubleshooting the MARS tab for a customer who uses EMAR.
- 🔧 EMAR is a **separate platform** with its own support team (Ryan's team). If a customer on EMAR has medication-related issues, escalate to the EMAR team, not standard EHR support.
- When to recommend EMAR vs. native MARS: The native MARS tab is considered **basic** in functionality. If an organization needs more robust medication administration or occupancy tracking, EMAR is the recommended path. A comparison document exists (created by Janelle Hall for True North) that outlines EMAR vs. native EHR capabilities — request from the implementation team.
- 🎫 **Common confusion**: When EMAR is active, users will not see the MARS tab, Medications tab, or E-Prescribe tab on the left-hand navigation. This is often reported as "missing tabs." See Common Issues below.

---

## DoseSpot / E-Prescribe Integration

- **DoseSpot** is a third-party e-prescribing platform. When a customer has DoseSpot, an additional **E-Prescribe** tab appears in the left-hand navigation.
- There is also a **patient-level E-Prescribe tab** within the patient's chart (newer feature; may not be present in all tenants). This shows active medications and allows prescribing for that specific patient.
- ⚠️ **Prescriptions entered through E-Prescribe do NOT automatically transfer to the Medications tab.** These are two separate workflows. If an organization wants a DoseSpot-prescribed medication tracked in MARS, they must manually add it to the Medications tab as well.
- 🔧 E-Prescribe troubleshooting (loading errors, tab not functioning) should be escalated by **creating a Linear task** — the engineering team handles DoseSpot escalations, which are then escalated to DoseSpot directly. This is **not** something users or front-line support can resolve.
- If EMAR is enabled, the E-Prescribe tab is also disabled.

---

## Medication Protocols

### Transfer-to-MARS Toggle

- On the **Scheduled Medications** section of the patient chart, there is a **"Transfer Medications to MARS"** toggle.
- When this toggle is **on**, the scheduled medications for that patient will appear in the MARS tab.
- When this toggle is **off**, scheduled medications exist on the patient chart but will not appear in MARS.
- ⚠️ This is the most common reason medications are missing from MARS. Always verify this toggle first.
- PRN medications follow a similar logic — they must be active and added to the patient chart before they can be documented via the MARS Add PRN flow.

### Predefined Protocols

- **Predefined protocols** (also called **standing orders**) allow organizations to create a preset group of medications that can be applied to a patient in one click.
- **Common use case**: Detox patients who typically receive the same set of medications upon admission. Instead of manually adding each medication individually, staff select the protocol and all medications are added at once.
- **Another common use case**: A standard PRN list that should always be available for a patient. Adding the protocol ensures those PRN medications appear in the chart and are available in the MARS Add PRN dropdown.
- Predefined protocols can include both **scheduled medications** and **PRN medications**.

#### Full Workflow: Creating a Predefined Protocol from Scratch

1. Navigate to **Settings → Predefined Protocols**.
2. Click **New**.
3. Type in the **name** of the predefined protocol.
4. Click **New Scheduled Medication** to add each medication:
   - Select the medication name, route, dosage, frequency, and times.
   - For the **start day** and **end day** fields: These represent relative days from when the protocol is applied (e.g., Day 1 to Day 7, Day 2 to Day 8, etc.). This allows for tapering protocols where different medications are active for different day ranges.
   - ⚠️ Janelle noted she typically sets the start day to **Day 1** and uses **"Until Discharge"** when she is unsure of the end date, as the value can be edited per patient later. Setting a numeric end day (e.g., "10") is believed to mean 10 days after the protocol start date, but this behavior has not been fully confirmed — treat with caution.
   - If the day fields are left blank or set to Day 0, this can cause unexpected behavior. Recommended: use Day 1 as default if uncertain.
5. Repeat for each medication in the protocol.
6. Save the protocol.

#### Applying a Predefined Protocol to a Patient

1. Navigate to the patient's chart → **Medications** tab.
2. Click **New Protocol** (or "Create New Protocol").
3. Choose the **start date and time** for when the protocol should begin.
4. Select the **predefined protocol** from the dropdown.
5. Click **Save**.
6. All medications in the protocol are now added to the patient's Medications tab and will transfer to MARS (as long as the Transfer-to-MARS toggle is enabled).

#### Editing a Predefined Protocol

- Navigate to **Settings → Predefined Protocols**.
- Click the **green pencil icon** next to the protocol to edit.
- You can add, remove, or modify medications within the protocol.
- Changes to the protocol do **not** retroactively affect medications already applied to patients.

---

## Doctor Orders

- The **Doctor Orders** tab is a **configurable feature** — it is turned on or off per tenant by the engineering team. Not all organizations use it.
- 🔧 To enable Doctor Orders for a tenant, a configuration request to engineering is required.
- **Use case**: Organizations where a nurse or staff member sets up the medications a patient will receive, but a physician or prescribing provider must sign off before the medications are administered. Doctor Orders adds an **approval/signature step** before medications flow into the patient chart and MARS.

### Doctor Orders Workflow

1. A nurse/staff member navigates to the **Doctor Orders tab** within the patient chart and creates a new order.
2. They add **scheduled medications** and/or **PRN medications** (same fields as the Medications tab).
3. The form is saved in **pending status**, flagging it for provider review.
4. The provider reviews the order and adds their **signature**.
5. Once the Doctor Order is marked as **completed**, the medications automatically appear on the **Medications tab** and also **transfer to MARS**.
- The complete flow is: **Doctor Order → Medications tab → MARS**.

### Doctor Orders Form Customization

- The Doctor Orders form has **pre-built sections** (active medications, PRN medications, discontinued medications, etc.) that always appear and **cannot be removed or reordered** without a change request to engineering.
- Organizations can customize the form by adding **signature lines** and **additional text/fields** via the Doctor Orders form template in **Settings → Documents and Forms → Doctor Orders Forms**.
- ⚠️ If a customer wants to modify the auto-populating medication sections of the Doctor Order form (not just the signature/text sections), this requires a **change request** to engineering.

### Bypassing Doctor Orders

- Even when Doctor Orders is enabled, users can still **add medications directly to the Medications tab** without going through Doctor Orders. This bypasses the signature step.
- ⚠️ This means Doctor Orders is not an enforced access control — it is a workflow tool. Organizations relying on it for compliance should be advised to control access via **roles and permissions** (restricting direct medication add/edit).

---

## Medication Settings

- Custom medications, routes, and units of measurement can be managed in **Settings → Medications**.
- 🎫 **Common support scenario**: A user reports that a specific medication does not appear in the search list. Resolution: Navigate to Settings → Medications → click **New** → type in the medication name. This adds it to the searchable list immediately.
- Routes and units of measurement follow the same process — click New in the respective section.
- The default medication list is already extensive, but any gaps can be filled by the organization's admin users directly (no engineering involvement needed for this).

---

## Roles & Permissions for Medications

- Access to the **Medications tab** and the **MARS tab** can be controlled per role in **Settings → Roles & Permissions**.
- Within medications specifically, the ability to **edit** and/or **delete** a medication can be independently enabled or disabled per role.
- A **case manager**, for example, would typically not need access to medications or E-Prescribe. Janelle's recommendation: restrict access to medications for non-clinical roles.
- ⚠️ Roles and permissions control tab-level and action-level access, but they do not prevent a user from bypassing Doctor Orders if they have direct Medications tab access.

---

## Common Issues in Support Tickets

### "Medications tab is missing"
- Check if the customer uses **EMAR** — if so, the Medications tab is intentionally hidden. This is expected behavior.
- Check if the user's **role** restricts access to the Medications tab. Navigate to Settings → Roles & Permissions to verify.
- Check if the user is in **All Locations view** — the Medications tab is not available from the all-locations view; users must be in a specific location.

### "MARS tab is missing"
- Check if the customer uses **EMAR** — if so, the MARS tab is intentionally disabled.
- Check the user's **role permissions** — the MARS tab access may be restricted.
- Check if the user is in **All Locations view** — MARS is not available in all-locations view.

### "MARS not showing medications"
- Verify the **Transfer-to-MARS toggle** is enabled for the patient on their Medications tab.
- Check that the medication order is **active** — confirm the current date/time falls within the medication's start and end date range.
- If the medication shows as **inactive**, the start date/time may be set in the future. This resolves on its own when the start time is reached.
- If the customer uses **Doctor Orders**, confirm the Doctor Order has been marked as **completed** (signed by the provider). Medications do not flow to MARS from a pending or draft Doctor Order.

### "PRN medication not appearing in MARS Add PRN dropdown"
- Confirm the medication was **added to the patient's chart** as a PRN medication (not just a scheduled one).
- Confirm the PRN medication's status is **active** (start date has passed, end date has not).
- The MARS Add PRN dropdown only shows medications linked to that specific patient's chart. If the medication exists in the global list but not on the patient chart, it will not appear here.

### "E-Prescribe tab not loading or not working"
- This is **not** resolvable by the user or front-line support.
- Create a **Linear task** for the engineering team to investigate. Engineering will escalate to DoseSpot as needed.
- Do not attempt to troubleshoot DoseSpot behavior directly.

### "Medication prescribed via E-Prescribe is not showing in Medications tab"
- This is **expected behavior**. DoseSpot prescriptions do not automatically transfer to the Medications tab.
- The user must manually add the medication to the Medications tab if they want it tracked in MARS.

### "Doctor Orders tab is missing from patient chart"
- Doctor Orders is a **configurable feature** that must be enabled by the engineering team.
- 🔧 Submit a configuration request to engineering to enable it for the tenant.

### "Medication I need is not in the search list"
- Admin users can add the medication directly: **Settings → Medications → New**.
- No engineering involvement required.