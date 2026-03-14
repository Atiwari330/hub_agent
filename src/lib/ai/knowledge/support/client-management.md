# Client / Patient Management
## Overview
The client (patient) record is the central hub for all clinical and administrative data for a patient in Opus EHR. Understanding the patient screen and its capabilities is essential for many support workflows. Each customer's Opus instance is referred to as a **tenant**, identifiable by the customer's name at the beginning of the URL (e.g., `truenorth.opusehr.com`). All patient charts, appointments, documents, and billing data live within the tenant and are organized by location.

---

## Patient Entry
- New patients/clients are created in the system with their demographic information.
- Key fields include: name, date of birth, contact information, address, emergency contacts, and insurance details.
- Each patient gets a unique record that links to all their appointments, documents, and billing data.
- **A patient can only belong to one location at a time.** If a patient needs to be moved to a different location, use the **Move Patient** feature (accessible via the Options button on the patient chart). This moves the full patient chart to the new location.
- Alternatively, a patient can be discharged from one location and a new episode of care opened at the second location — this is a common workflow for multi-location organizations.
- **Episode of Care:** Each time a patient begins treatment, an episode of care is created. When a patient is discharged, their episode is ended and they become inactive. If a patient returns for a second course of treatment, the correct workflow is to click **New Episode of Care** — simply reactivating them does *not* create a new episode.
- **Deleting vs. Deactivating:** Deleting a patient should only be done if the record was created by mistake. The preferred workflow for real patients who have completed treatment is to mark them inactive or discharge them. If a patient is accidentally deleted, their record can be restored from **Settings > Deleted Data**.

### New Patient Registration via Patient Portal
- Patients can self-register through the patient portal as either a **new patient** or an **existing patient**.
- The new patient flow captures all demographics and insurance information and submits a request visible under the **Patient Requests** tab in the EHR.
- The system will flag potential duplicate records at the time of approval, based on matching combinations of date of birth, email address, and phone number.
- Upon approval of a new patient request, the system creates the patient chart in **Pending** status and schedules the appointment simultaneously.
- Customers can also enable a **New Patient Registration** option (separate from appointment requests) that allows patients to submit their intake paperwork and demographics without requesting an appointment — this is especially useful for pre-intake workflows.

---

## Insurance Setup
- Insurance information is stored on the patient record and is critical to the billing pipeline.
- Insurance must be set up **before** encounters can be properly billed — it flows from the patient record into the encounter → claim pipeline.
- Patients can have primary and secondary insurance.
- Insurance details include: payer, plan, member ID, group number, and authorization info.
- **For billing purposes, insurance requires the patient's sex at birth (male or female only).** Insurance carriers do not accept other gender values. Opus supports a separate preferred name/gender field for clinical use, but the sex at birth field must reflect what is on file with the insurance carrier.

### Authorization Numbers & Utilization Review (UR)
- The **Utilization Review (UR) tab** (also called the Utilization tab) is where authorization numbers are tracked for insurance-approved services.
- When an authorization number is entered in the UR tab for a specific service and date range, it **automatically flows onto the corresponding encounters** within that approval window — this is a key selling point for behavioral health clients, as pre-authorizations are critical for reimbursement.
- The UR tab is most commonly used for two scenarios:
  1. **Inpatient / Per Diem billing:** Scheduling levels of care and tracking approved units.
  2. **Outpatient services:** Attaching authorization numbers to specific CPT codes so they appear on claims automatically.
- Insurance companies use utilization review to ensure services are medically necessary and not fraudulent — it is essentially an insurer QA process with defined approval windows (e.g., "approved through March 31st").

---

## Patient Screen & Filtering
- The patient screen provides a list view of all patients within the currently selected location.
- When in **All Locations** view, only a limited set of tabs are shown (Patients, Documents, Schedule, Groups, Billing) — this is by design, as some tabs are location-specific (e.g., Mars, Occupancy).
- Filtering capabilities allow searching and narrowing by various criteria.

### Common Filter Use Cases
- Finding a specific patient by name or ID.
- Filtering patients by provider or caseload assignment.
- Viewing patients by status (active, inactive, discharged/pending).
- **Caseload filtering:** If a user's role has the "Can see all patients, not only those on user's caseload" permission turned **off**, they will only see patients assigned to them. This is a common and intentional setting for clinicians. Intake coordinators and billing staff typically need this permission turned **on**.
- **Location filtering:** A patient's chart is only visible within the location they belong to. Searching in the wrong location will return no results even if the patient exists in the system.

---

## Demographics
- Patient demographics include personal info, contact details, and clinical identifiers.
- Demographics must be kept up to date as they flow into clinical documentation and billing.
- **Appointment Reminders:** Reminders are sent to both the patient's email address and phone number (as text) if both are on file. If only one contact method is present, only that method is used. The reminder timing is configurable per location in Settings (default is 48 hours before the appointment). Note: there is currently no front-facing log for customers to verify if/when a reminder was delivered — this is only accessible on the backend by the engineering team.
- **Diagnosis Codes:** Diagnosis codes can be added directly to the patient chart (recommended for recurring diagnoses) or added per appointment. Codes added to the patient chart auto-populate on new appointments based on their active date range. A diagnosis code with an active-from date of today will not appear on appointments scheduled for yesterday. Resolved codes (with a resolved-by date) will no longer populate on future appointments after that date.
- **Patient Calendar:** Within the patient chart, individual days can be used to schedule levels of care directly, in addition to the main Schedule tab.

### AI Features
- A **Generate Patient Summary** option is available from the Options button on the patient chart — this uses AI to produce a clinical summary of the patient's record.
- An **AI Note Summary** is also available within individual clinical documents to summarize completed notes (availability may vary by tenant).

---

## Common Issues in Support Tickets

### "Can't find a patient"
- **Check the active location.** Patients are location-specific — if the user is in the wrong location or the All Locations view, the patient may not appear. Switch to the patient's assigned location and search again.
- **Check the user's role permissions.** If the "Can see all patients" permission is off, the user will only see patients on their caseload. Verify whether this is intentional or if the permission needs to be updated by an admin.
- **Check status filters.** The patient may be filtered out because they are inactive, discharged, or in pending status. Adjust filters to include all statuses.
- **Check spelling** of the patient name and try searching by date of birth or patient ID if available.

### "Insurance not showing on claims"
- Verify that insurance is properly set up on the **patient record** — insurance does not exist at the encounter level alone; it must be on the chart.
- Check that the insurance was **active at the time of the appointment** (correct effective dates).
- Check the **Utilization Review (UR) tab** — if the service requires a prior authorization number and it hasn't been entered in UR with the correct approval date range, the authorization number will not appear on the encounter.
- Confirm that the **sex at birth** field on the patient demographic is set to male or female — this is required by insurance carriers and can cause claim rejections if missing or set to a non-standard value.
- Encounters will not sync to RCM if a required field is missing. Check the billing tab for the encounter status — it may show "missing provider," "document incomplete," or "diagnosis code missing" in the status column.

### "Duplicate patient records"
- Sometimes patients are entered twice — this creates issues with documentation and billing continuity.
- The system provides a **duplicate warning** at the time of approving a new patient portal request, based on matching DOB, email, or phone number. Staff should review this warning before approving.
- If duplicates are identified after the fact, resolution requires careful handling to preserve documentation and billing history. Merging is not a native self-serve feature — escalate to the engineering/support team as needed.
- **Prevention tip:** Encourage customers to use the patient search before creating a new record, and to review duplicate warnings in the patient request approval flow.

### "Tasks showing on the wrong person's to-do list"
- The to-do list auto-populates based on three triggers: (1) documents the user started and saved in draft/pending, (2) appointment-linked documents where the user is the primary provider, and (3) documents saved in pending by a supervisee (which route to the supervisor's list).
- If tasks are appearing for unexpected users, check the **supervisor settings** on the Providers tab — the supervisee/supervisor assignment may be incorrectly configured.
- Documents sent to the patient portal that return in **draft** status go back to the sending user's to-do list. Documents returning in **completed** status go to no one's list. Documents returning in **pending** status go to the sender's supervisor's list.

### "Patient can't be scheduled at a second location"
- This is expected behavior — patients can only be in one location at a time. The recommended solutions are:
  1. Use the **Move Patient** feature to transfer the chart to the new location.
  2. Discharge the patient from the current location and open a new episode of care at the second location.
  3. If the organization sees patients at multiple locations interchangeably, recommend consolidating into a **single location** and using **Places of Service** codes to differentiate where care was delivered — this avoids splitting the patient chart entirely.

### "E-Prescribe tab not loading or not working"
- E-Prescribe is powered by **Dosespot** (an integrated third-party platform). Troubleshooting for E-Prescribe issues should be escalated to the engineering team via a Linear task — end users cannot resolve these issues themselves, and the engineering team will escalate to Dosespot as needed.
- Note: If a customer uses **EMAR**, the Medications tab and MARS tab in the EHR are disabled — all medication management is handled in EMAR. This is by design and not a bug.