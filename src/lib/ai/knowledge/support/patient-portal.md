# Patient Portal

## Overview
The Opus EHR patient portal is a patient-facing interface that allows patients to register, request appointments, complete intake paperwork, view and sign documents, make payments, and communicate with their care team.

- The portal URL is tenant-specific (e.g., `demo.opus...`). Each customer has their own tenant/subdomain.
- Portal functionality is **per-patient opt-in** — each patient's portal access must be individually activated in their chart. If it is not turned on, none of the portal features will work for that patient.
- The portal can display the **organization's logo** in emails and on the portal UI — this is set under Location Settings by uploading a logo image. If no logo is configured, emails and the portal will render without branding.
- 🔧 **Portal messaging** (patient ↔ staff secure messaging) can be enabled or disabled per tenant by the engineering team. It is not toggleable by the customer through settings.

---

## New Patient Registration

### Overview of Registration Flows
There are **two distinct new-patient flows** available on the portal. Customers typically enable one or the other, not both simultaneously. Both are controlled through **Portal Settings**.

1. **New Patient Appointment Request** — Patient selects a service, location, and clinician, picks an available time slot, and provides demographics + insurance info. Creates a pending appointment request + patient chart.
2. **New Patient Registration (no appointment)** — Patient provides demographics + insurance and completes any configured intake documents, but does not schedule an appointment. This feature was originally built for True North and is relatively new (released a few months prior to training — January 2026). Customers that haven't been onboarded recently may not have it.

### New Patient Appointment Request Flow (step-by-step)
- Patient navigates to the portal link (typically placed on the customer's website).
- Patient selects **"I'm a new patient"** → **"New appointment request"**.
- Patient selects: Service → Location → Clinician → Date/Time.
- Available times shown are based on the selected clinician's **configured availability** in the EHR. If no availability is set for that service by any clinician, no times will display.
- Patient enters full demographics (name, DOB, address, etc.) and insurance information.
  - ⚠️ Whether insurance info is requested is a **configurable setting** in Portal Settings. Customers can turn this off.
- Patient submits request. Portal displays a message indicating the appointment is **not yet confirmed** and they will receive a confirmation.
- Request appears in the **Patient Requests tab** in the EHR under the "New Patient" category.

### New Patient Registration Flow (step-by-step)
- Patient selects **"I'm a new patient"** → **"New patient registration"**.
- Patient selects a location, fills in demographics and insurance info.
- If the customer has configured **intake documentation**, the patient will be prompted to complete those forms before submitting.
  - Which intake documents appear here is configured in **Portal Settings → Patient Registration Request → Select Documents**.
- On submission, the request appears in the **Patient Requests tab** under the patient registration queue (separate from appointment requests).
- On approval, a patient chart is created in **pending status**.

### Staff Approval of New Patient Requests
- All new patient submissions (both flows) route to **Patient Requests tab** in the EHR.
- Staff can click **View** to see all submitted details and make edits before approving.
- Clicking **Approve** creates the patient chart in pending status (and, for the appointment request flow, also schedules the appointment on the calendar).
- Staff can also **Deny** requests.
- ⚠️ **Duplicate detection**: The system checks for potential duplicate records at approval time based on matching combinations of **date of birth, email address, and/or phone number**. If a match is found, staff are warned before approving. This does not automatically block approval — staff must make the judgment call.
- Approved new patients are created with chart status of **Pending** (not Active). Staff typically need to move them to Active after their first appointment.

### Portal Access Activation
- Within the patient's chart, there is a toggle to **turn on portal access**. This must be enabled before any portal functionality works for that patient.
- When first activated, the patient receives an **email with a portal access link** (includes the organization's logo if configured).
- ⚠️ **Expired portal links**: If the patient's link has expired, the portal will display a message prompting them to enter their email to request a new link — patients can self-serve this.
- Staff can also manually re-send the portal link at any time via **Options → Send Patient Portal Link** within the patient chart.
- Existing patients log in by clicking "I'm an existing patient" and entering their email.

---

## Appointment Requests

### How Appointment Requests Work
- Patients can request appointments through the portal for services that are configured as available.
- The system shows available times based on **provider availability settings** in the EHR — if a provider has not set up availability for a service, no times will show.
- Available services in the portal are determined by two independent settings that must **both** be true:
  1. The **service** must have **"Available for existing patients"** (or **"Available for new patients"** for new patient flow) toggled **on** in the service settings.
  2. A **clinician must have that service added to their availability** in the Availability tab.
- 🎫 **Common issue**: If appointment request shows no available times, first verify both of the above conditions are met.
- When a patient submits a request, the portal displays a "pending confirmation" message. The request does not become a confirmed appointment until a staff member approves it.

### Staff Approval Flow
- Appointment requests appear under the **Patient Requests tab** in the EHR.
- Staff click **View** to see full details, then **Approve and Next** to schedule.
- On approval, the appointment is added to the **schedule** and the patient receives a **confirmation notification** (email and/or text).
- ⚠️ There is **no Google Calendar, Outlook, or iCal integration** — patients do not receive calendar invites to their personal calendar apps.

### Portal Settings That Affect Appointment Requests
All of the following are configurable in **Settings → Patient Portal**:
- **Enable appointment requests** — master toggle; if off, patients cannot request appointments at all.
- **Appointment time slot display**: by service duration, on the full hour, half hour, or quarter hour.
- **How far in advance** patients can request appointments.
- **How soon / same-day appointments**: whether patients can request same-day appointments.
- **New patient appointment requests**: can be toggled independently from the existing patient appointment request feature.
- **Insurance info required**: whether to prompt new patients for insurance during the request flow.

---

## Document Delivery & Return Statuses

### How to Send Documents to the Portal
Documents can be sent to the patient portal from three locations in the EHR:
1. **From the patient chart** → Doc Request / Sharing button → "Request new documents"
2. **From an appointment** → Doc Request / Sharing button (same screen, different entry point)
3. **From the Documents tab (bulk)** → Select multiple patients → send documents to all at once (used for mass document delivery, e.g., a holiday closure letter)

### Document Sending Options
- **Request new documents** — sends a blank template for the patient to complete.
- **Share existing documents** — sends a previously completed document to the patient for viewing or signing.
- **Recurring documents** — sets up automatic document delivery on a schedule (e.g., monthly PHQ-9).
- **Document packages** — sends a pre-configured bundle of multiple documents in a single click.
  - ⚠️ Document packages are **strictly for the patient portal**. They are different from "form groups," which are for internal EHR use by staff.
  - Packages are configured in **Settings → Document Packages**.

### Return Statuses and Routing Behavior
When a patient completes a document in the portal, it returns to the EHR with a status. This status is **configurable in Portal Settings** and determines where the completed document routes.

| Return Status | What It Means | Routing |
|---|---|---|
| **Draft** | Document returned; needs staff review/completion | Goes to the **sending user's to-do list** |
| **Pending** | Document returned; requires supervisor sign-off | Goes to the **sender's supervisor's to-do list** |
| **Completed** | Document returned and considered finalized | Does **not** appear on anyone's to-do list; lands on patient chart |

**Recommended configuration (per Janelle Hall, Implementation Specialist):**
- Use **Draft** if staff want to review documents before marking them complete.
- Use **Completed** if no review is needed and documents should be auto-finalized.
- ⚠️ **Do NOT use Pending as the default return status** unless supervisor review is explicitly required. If supervisor settings are configured in the provider tab, returning documents in Pending status will route them to the supervisor's to-do list — this can create confusion and unexpected routing behavior, especially if the supervisor was not expecting to review portal intake docs.

- 🎫 **Common support issue**: Staff report documents showing up on the wrong person's to-do list. Check: (1) what return status is configured in Portal Settings, (2) whether the staff member who sent the document has a supervisor assigned in their provider settings.

### File Upload Requests
- When sending a document request, there is a toggle called **"Request this document as file upload."**
- This should only be enabled when asking the patient to upload a file (e.g., insurance card photo). Leave it off for standard form completion.

---

## Patient Check-In

- Patients can check in through the portal from the **Appointments tab** in their portal view.
- Check-in records a **timestamp** visible on the appointment in the EHR when opened.
- ⚠️ Check-in **does not trigger any notification** to staff — it is a passive status indicator only. Staff must open the appointment to see if the patient has checked in.
- Intended use cases:
  - **Telehealth**: patient indicates they are in the meeting/ready to start.
  - **In-person**: intake staff can see the patient has arrived.
- Not widely used by customers. If a patient is confused about why checking in doesn't seem to do anything, the answer is that it is informational only.
- **Upcoming appointments** are visible in the portal's **Appointments tab**. Patients can also cancel upcoming appointments from this view.
  - 🔧 The ability for patients to cancel appointments via the portal can be **disabled** if the customer does not want that functionality. This is a portal setting.
- If a telehealth integration (Zoom, Google Meet, Microsoft Teams) is configured, patients can **join the meeting** directly from the portal appointment view.

---

## Portal Messaging

- Secure messaging between patients and staff is accessible from the **Messages tab** in the portal.
- When a patient sends a message, a **red notification icon** appears in the EHR top navigation for the patient's **primary provider**.
- Staff can view and respond to messages from the **messaging icon** in the upper-right of the EHR. They can search for a patient to find the conversation.
- **Mass messaging**: Staff can send a message to multiple patients simultaneously via "Send Mass Message." Each patient receives an individual message — it is not a group chat.
- 🔧 Portal messaging can be **turned on or off at the tenant level by the engineering team**. It is not configurable through the Settings UI by the customer.

---

## Payment

- Patients can add a credit card on file and pay their balance from the portal home screen.
- **Current payment integration: Imagine Pay** (migrated from Practice Suite).
- ⚠️ The demo environment may still display the Practice Suite payment UI, which looks slightly different, but the concept and workflow are the same.
- The payments tab in the portal is labeled as a billing/payments section and allows patients to view and pay outstanding balances.

---

## Portal Settings

Portal settings are primarily located in **Settings → Patient Portal** and are configurable per the organization (some settings interact with per-location configuration). Key settings and what they control:

### Appointment Request Settings
- **Enable appointment requests** (master toggle)
- Time slot display format (by service duration / full hour / half hour / quarter hour)
- How far in advance patients can request
- Same-day appointment requests (on/off)
- New patient appointment requests (separate toggle from existing patient requests)
- Insurance info collection during new patient flow (on/off)

### Document Return Settings
- **Document return status** (Draft / Pending / Completed) — applies to all documents returned from the portal for this organization.

### Patient Registration Request Settings
- **Patient registration request** feature toggle (on/off — controls whether the "New Patient Registration" button appears on the portal landing page)
- **Which intake documents** are required during new patient registration (select from form builder templates)

### Per-Location Portal Display Settings
- **Display name** — the patient-facing name for the location (can differ from internal name)
- **Location description** — shown to patients when selecting a location on the portal
- **Logo** — set in location settings; appears in portal emails and on the portal header

### What Engineering Controls (Not Configurable in Settings UI)
- 🔧 Turning **portal messaging** on or off
- 🔧 Turning off patient ability to **cancel appointments** via portal
- 🔧 All telehealth integrations (Zoom, Google Meet, Microsoft Teams) are configured by the engineering team

---

## Common Issues in Support Tickets

### 🎫 "Patient can't log into the portal"
- Verify the **patient's portal access is toggled on** in their chart (most common cause).
- Verify the patient has a **valid email address** on file — reminders and portal access links are sent to email.
- If the patient's link is expired: direct patient to re-enter their email on the expired link page to request a new link self-service, OR staff can resend via **Options → Send Patient Portal Link** in the patient chart.
- Check that the patient is using the correct portal URL for their organization (tenant-specific subdomain).

### 🎫 "Documents sent to portal aren't showing for the patient"
- Verify the document was sent to the **correct patient**.
- Check the **document delivery status** in the EHR — confirm it was sent (will show in the patient's Doc Request/Sharing view as a pending or sent item).
- Verify the patient's **portal access is turned on** — documents won't be visible in the portal if portal access is inactive.
- Verify the patient is logging into the correct location/portal.

### 🎫 "Patient completed a form but it's not showing as complete"
- Check the **return status setting** in Portal Settings.
  - If set to **Draft**: the document returned to the sending user's to-do list; staff must mark it completed. It is NOT on the patient chart as completed.
  - If set to **Pending**: the document went to the sender's supervisor's to-do list. The supervisor must review and complete it.
  - If set to **Completed**: it should appear as completed on the patient chart automatically. If it still isn't showing, escalate — this may be a backend issue.
- 🎫 If staff report documents appearing on unexpected people's to-do lists: check (1) return status in Portal Settings, and (2) supervisor assignments in provider settings.

### 🎫 "Patient portal shows no available appointment times"
- Two conditions must BOTH be true for times to appear:
  1. The **service must have "Available for existing patients" or "Available for new patients"** toggled on in service settings.
  2. A **clinician must have the service in their availability** in the Availability tab, with times set for the relevant period.
- If availability is set up but the specific dates being requested fall outside the configured availability window, no times will show for those dates.
- Note: Availability in the EHR gates what patients can *request*. Internal staff can override and schedule outside availability hours with a warning prompt ("create anyway").

### 🎫 "New patient submitted a registration/appointment request but it's not appearing"
- Check the **Patient Requests tab** in the EHR — all new patient portal submissions route here. Confirm the staff member viewing requests has access to the correct location.
- Confirm the relevant feature (appointment requests or new patient registration) is **turned on** in Portal Settings.
- If only one option is showing on the portal landing page (new appointment request OR new patient registration), that is expected — customers typically enable only one of the two flows.

### 🎫 "Approved new patient isn't showing as active"
- This is expected behavior. When a new patient request is approved, the chart is created in **Pending** status. Staff must manually move them to **Active**.

### 🎫 "Patient says they checked in but staff don't see it"
- Check-in does not notify staff — staff must **open the appointment** to see the check-in timestamp. There is no proactive alert.

### 🎫 "Portal messaging not working / Messages tab not visible"
- Portal messaging is controlled at the backend level. If it's not visible or not functioning, escalate to engineering to confirm it is enabled for the tenant.