# Scheduling & Appointments

## Overview
The schedule is a core component of Opus EHR. Appointments carry documentation requirements and are the starting point for the billing pipeline. Understanding how scheduling works is essential for troubleshooting many support issues.

- The **Schedule tab** surfaces a calendar view of all appointments, group sessions, wait list, and levels of care.
- A companion **Groups tab** exists as an alternate view for group sessions only; used by customers with high group session volume. It is not used by all customers.
- The **Availability tab** (left nav) is tightly coupled to the schedule and to patient portal appointment requests.
- Filters set on the Schedule tab **persist** when the user navigates away and returns. If a user reports the schedule looks wrong or is missing appointments, check active filters first.
- As a provider, the schedule always **defaults to filtering by the logged-in provider's own schedule** on load.
- Tabs visible in the left nav (including the Schedule tab itself) depend on the user's **role permissions** and whether the user is in **All Locations view**. In All Locations view, only Patients, Documents, Schedule, Groups, and Billing tabs are available.

---

## Creating Appointments

Appointments are created in the schedule view.

### Methods
- **New Event button** (top of schedule view)
- **Drag and drop** directly on the calendar (works like Google Calendar — drag to the desired time slot on the desired date)
  - Appointment start time and date auto-fill from the drag position
- **Follow-up button** inside an existing appointment — opens a pre-populated new appointment screen for the same patient

### Required / Auto-populated Fields
Each appointment is linked to:
- A **patient/client**
  - Any **insurance on file** for the patient auto-populates when the patient is selected
  - Any **diagnosis codes** on the patient's chart auto-populate when the patient is selected
- A **provider** (clinician)
  - ⚠️ The **services list is filtered by whatever services have been configured for that provider**. If the provider is removed or left blank, the full service list appears. If a user can't find a service in the dropdown, check provider-level service configuration first.
- A **service type / CPT code** (e.g., 90791 for psychiatric diagnostic evaluation)
  - Services are set up in **Settings → Services** and can have a display color, default duration, linked documents, and billing modifiers attached
- A **place of service**
  - 🔧 Place of service options are configured by the engineering team — not customizable by the customer through settings directly. The billing code is a standard billing code (e.g., 11 = office, 10 or 02 = telehealth). The *display name* of the place of service can be customized and is done frequently during onboarding.
- A **date and time**

### Optional Fields
- **Room**: tracks which room in the organization the appointment is in. Customizable through settings. Not universally used.
- **Diagnosis codes**: added per-appointment only. ⚠️ Diagnosis codes added on the appointment do NOT carry over to the patient's chart — they apply to that appointment only. Providers/intake staff should add diagnosis codes to the patient chart for them to auto-populate on future appointments.
- **Units**: defaults to 1 unless duration automation is enabled (see Services Settings). Can be manually overridden on the appointment.
- **Video meeting link**: Zoom, Google Meet, or Microsoft Teams — toggled on per appointment. Adds the provider's own meeting link to the appointment and includes it in appointment reminder notifications and the patient portal.
  - 🔧 Video meeting integrations are configured by the engineering team. Multiple platforms (e.g., both Zoom and Google Meet) can be active simultaneously on the same tenant.
  - ⚠️ If a provider doesn't have a video platform connected, toggling the meeting link will produce a warning that the link could not be added. Common causes: provider's email in Opus doesn't match their Zoom/Teams/Meet account, or the provider isn't added to the organization's Zoom business account.
  - Third-party platforms like ZocDoc are not natively integrated. Some customers work around this by pasting the external link into the appointment's **Reason** field for internal staff reference.
- **Reason**: free-text field. Used informally for notes or external links.

### Appointment is the entry point for:
1. Clinical documentation (TO DO list)
2. Billing (appointment → encounter → claim)

### Appointment Status Indicators
- **Show status field**: Mark appointment as Show, No Show, Canceled, or Canceled Late
- **Check-in button**: Manual toggle. Does not automate anything in the system. Intended to allow intake staff to signal to the provider that a patient has arrived. Not widely used across all customers.
- **Calendar color indicator**:
  - Document attached to appointment and **incomplete** (draft, pending, or not yet started): appointment block shows a **red icon**
  - Document **completed and locked**: appointment block shows a **green checkmark**

### Other Appointment Actions
- **Resend invitation**: resends the appointment confirmation email/text to the patient
- **Doc Request & Sharing button**: navigates to the patient portal document sending screen
- **Follow-up button**: opens a new appointment creation screen pre-populated for the same patient
- **Edit/Delete button**: reopens the appointment for edits or deletes it

---

## Document Status on Appointments — "Not Created" (Limbo) State

This is a **common source of confusion** and support tickets.

- When a service has a document linked to it (configured in Services Settings), that document appears attached to the appointment **immediately upon scheduling**.
- ⚠️ **This document is NOT in Draft, Pending, or Completed status — it is in a "not created" state.** It has no reference number and technically does not exist yet as a saved document.
- The document only enters a real status (Draft, Pending, or Completed) once the provider opens it and clicks Save.
- **The "Document Incomplete" filter on the schedule will still flag appointments with not-created documents** — the filter means "any appointment with an attached document that is not fully completed," regardless of whether the document has been started.
- Bulk-signing and bulk-completion operations (available from the group session notes view and the Documents tab) **only act on documents in Pending status**. Not-created documents are excluded.

---

## Navigational Tabs Inside an Appointment Document
When a document is opened from an appointment context, two extra navigation tabs appear on the right side:

- **CPT Codes tab**: shows CPT codes associated with the appointment. Can add new codes, delete codes, and update unit counts from here. Only available on appointment-linked documents.
- **Appointment tab**: allows updating appointment fields (start/end time, place of service, etc.) without closing the document and returning to the schedule. Useful when a session runs long.

---

## Recurrence

- Appointments can be set up with recurrence (weekly, biweekly, monthly, etc.) via the **Make Event Recurring** toggle — works similarly to Google Calendar.
- Can specify number of occurrences or an end date.
- When **modifying a recurring appointment**, the system asks whether to update:
  - **This event only**
  - **This and following events**
  - **All events** (including past instances — use with caution)
- 🎫 If a user wants to move a recurring appointment to a different day going forward (e.g., Thursdays → Mondays), the correct approach is to modify "this and following events" with the new day/time.
- Recurring appointments generate individual appointment instances. Changes to one instance do not affect others unless "this and following" or "all events" is selected.
- ⚠️ Documents linked to a service are attached **to every instance** of a recurring appointment. The provider must complete the document for each occurrence.
- Appointments **can be dragged and dropped** to a different time or day on the calendar, including across different days in the week view.

---

## Appointment-Linked Documentation

- Each appointment generates **documentation requirements** that appear on the provider's TO DO list.
- Required forms (intake assessment, progress note, etc.) are connected to the specific scheduled event.
- ⚠️ **Documentation must be completed through the appointment or the TO DO list — NOT by creating the same document type from the client chart directly.** Creating a document from the chart does not fulfill the appointment-linked TO DO requirement. This is one of the most common sources of user confusion.
- Providers can also manually **attach documents to an appointment** (in addition to auto-attached service documents):
  - Attach an existing document already in the patient's chart
  - Create a brand new document from the attachment screen
  - Attach a previously uploaded file from the patient's chart

---

## Services Settings (Schedule Configuration)

Found in **Settings → Services**. These settings control what appears in the appointment service dropdown and how billing automation works.

- **Service name**: customizable display label (e.g., "Psychiatric Evaluation" for CPT 90791)
- **Schedule color**: all appointments scheduled with this service display in the chosen color on the calendar
- **Default duration** (for duration automation):
  - 🔧 Duration automation must be enabled by the engineering team as a tenant-level configuration
  - Once enabled, set the default duration (e.g., 30 minutes) on the service
  - Opus will then auto-calculate units: a 60-minute session = 2 units, 90-minute = 3 units, etc.
  - If default duration is left blank, no automation runs and units always default to 1 unless manually updated
  - ⚠️ Unit automation is **per service** — if an appointment has multiple services, each service calculates independently. A service without a default duration will always stay at 1 unit even if the other service is automating.
  - ⚠️ The duration (minutes) on an appointment and the unit count do NOT automatically sync in both directions. Providers must set the duration correctly for automation to produce the right unit count. Units can always be manually corrected on the appointment.
- **Linked documents**: one or more form templates can be attached to a service. When this service is scheduled, those documents auto-attach to the appointment (in "not created" state).
- **Portal availability**:
  - *Available for existing patients*: allows existing patients to request this service via the patient portal
  - *Available for new patients*: allows new patients to request this service via the new patient registration flow
- **Buffer time**: can block minutes before and/or after the appointment slot
- **Billing code and modifiers**:
  - Standard CPT code (e.g., 90791) and optional modifiers (e.g., 95 for telehealth) can be configured here
  - ⚠️ Since the move from Practice Suite to Imagine RCM, modifier rules are more commonly managed on the Imagine/RCM side rather than in Opus EHR. Customer-specific modifier needs should be discussed with the RCM team.
  - Revenue code field: for UB-04 institutional claims (e.g., IOP). Set in coordination with RCM team.
- **Non-billable service**:
  - If the *Billable Service* checkbox is unchecked, the service will appear on the schedule but will not flow to the billing pipeline for claim creation
  - ⚠️ Ambiguity in transcripts: it is likely (but not fully confirmed) that non-billable services still appear in the **Not Billable tab** of the Billing section, rather than not appearing at all. Verify with RCM/engineering if a customer reports a non-billable service appearing unexpectedly.

---

## Group Sessions

- Group sessions allow multiple patients to be scheduled for the same time slot with the same provider.
- Each patient in the group gets their own documentation requirements.
- Group appointments still generate individual encounters for billing purposes.

### Creating a Group Session
- Same flow as individual appointment, plus:
  - **Facilitators**: separate from the billing provider — a different staff member can be listed as the facilitator for the session
  - **Group type**: a pre-built agenda template selected at scheduling time. Populates onto all group session notes automatically. Can be edited at the time of scheduling or within the document. Managed in **Settings → Group Types**.
  - **Participants**: added individually by search, or via **Add Multiple Patients** (filterable by level of care and status)
  - Per-patient overrides: individual participants can have a different service or insurance specified within the group appointment if needed
- ⚠️ If the provider doesn't have availability set for that time, the system warns but allows override via **Create Anyway**

### Group Session Notes View
- A dedicated **Open All Group Notes** button is available on the group session appointment
- This view shows all participants' notes in a single screen, navigable from the left-side participant list
- **Copy Content / Paste Content**: copy the content of one participant's completed note and paste it into another's. Useful for shared group content (e.g., topics discussed). Does not copy the signature — each note still requires individual signing.
- **Bulk Signing**: available from the Settings button in the group notes view. Select a signature field → click Use My Signature → review all documents → Sign All. ⚠️ Only works on documents that have been saved in **Pending** status. Not-created documents are not included.
- **Bulk Complete**: same behavior — only acts on Pending documents. Marks all selected documents as Completed in one action.
- These bulk operations are also available from the Documents tab and the TO DO list, and are used frequently by supervisors reviewing and co-signing notes.

### Group Types Settings
- Found in **Settings → Group Types**
- Folder-based, multilevel agenda system (folders can contain sub-agendas)
- Fully customizable — add, edit, or delete agendas and folders
- Default agendas are seeded when a new tenant is created; can be adjusted to match the customer's workflow
- 🔧 A **Group Roster** feature (allowing pre-set lists of patients for recurring groups) was scoped for True North and is in development as of early 2026. Not yet a general-availability feature.

---

## Wait List

- The **Wait List** is a feature added approximately 1.5 years ago, originally built for Transitions (a specific customer). Functionality may be more limited or specific than customers expect.
- Accessible from the Schedule tab (same "new event" area as appointments and group sessions)

### How It Works
1. **Add a patient to the wait list**: select the patient, the desired service, and optionally a preferred provider. This creates a wait list entry — no appointment is created.
2. **Create a wait list slot**: when an opening becomes available on a provider's calendar, staff create a wait list slot for that time. Specify the provider and eligible services.
3. **System sends an SMS** to all wait list patients whose service/provider preferences match the slot simultaneously.
4. **First patient to reply "Y"** via SMS is moved to the **Patient Requests** screen (same as a portal-requested appointment), where staff can confirm it.
5. All other patients who replied Y (or haven't replied yet) receive an SMS that the slot has been filled.
6. ⚠️ This is a first-come-first-served ("battle royale") system. Multiple patients receive the same SMS at once. There is no way to prioritize specific patients within the wait list.
7. A confirmed wait list slot and a regular scheduled appointment are **two separate items** — a patient can simultaneously be on the wait list and have a future confirmed appointment.

---

## Availability Tab

- Found as a separate tab in the left navigation
- Providers use this to define the days/times they are available
- Availability set here **grays out** unavailable times on the schedule calendar
- Attempting to schedule outside of a provider's set availability triggers a warning; can be overridden with **Create Anyway**
- Availability can be set as **recurring** (e.g., every Tuesday and Thursday 8:30 AM – 12:30 PM)
- Can specify which **services** and **place of service** are available during each block — this specifically controls what the patient sees in the portal when requesting an appointment

### ⚠️ Important Behavioral Notes
- If a provider has any availability set but has not set it for a given day/time, their calendar will appear **fully grayed out** for that period. Availability is all-or-nothing — partial setup looks like a completely blocked calendar.
- **Availability is most critical for**: customers using the patient portal for appointment requests, or customers where an intake team schedules on behalf of providers.
- If a provider self-schedules their own appointments and does not use the portal, availability settings are optional. Many customers don't use this feature at all.
- ⚠️ The schedule does **not** integrate with external calendars (Outlook, Google Calendar, etc.). A Google Calendar integration has been discussed internally but is not on the current roadmap as of early 2026. Providers who use both Opus and an external calendar must maintain both separately.

---

## "Other" Event Type (Calendar Blocking)

- Accessible from the same "new event" area on the schedule
- Creates an appointment with **no patient attached** — for internal purposes only
- Use cases: lunch blocks, internal meetings, out-of-office markers
- Multiple users can be included in the same "Other" event
- Does not generate an encounter or documentation requirement

---

## Patient Portal — Appointment Requests

*(Full portal documentation is in a separate KB section. Below is scheduling-specific behavior.)*

- Patient-requested appointments appear in the **Patient Requests** tab on the schedule
- Requests triggered from the wait list SMS flow also land here
- Staff can **approve or deny** requests from this view
- Portal appointment request settings (found in **Settings → Patient Portal**):
  - Enable/disable appointment requests entirely
  - Set appointment display increments (full hour, half hour, quarter hour)
  - Set how far in advance patients can request appointments
  - Allow or disallow same-day appointment requests
  - Allow or disallow new patient appointment requests (vs. new patient registration flow)

---

## Encounter / Billing Flow from Appointments

- Appointments flow to the **Billing tab** as encounters **automatically** once the appointment time has passed
- Future appointments do not appear in the Billing tab until after their scheduled time
- Non-billable services may appear in the **Not Billable** sub-tab of the Billing section (see note on ambiguity in Services Settings above)
- Diagnosis codes can be added or updated on an encounter from the Billing tab — these changes apply to the encounter only and do not update the patient's chart
- 🔧 **Auto-sync to RCM** is a configurable automation — by default, syncing is manual. Engineering can configure automatic sync after a set delay (e.g., 1 hour after ready status). Most customers start manual during onboarding and add automation later.

---

## Common Issues in Support Tickets

### Scheduling Conflicts
- Double-booking, overlapping appointments, provider availability issues.
- ⚠️ Opus does **not enforce** hard scheduling conflicts — if a provider is double-booked, the system may warn but will allow it with "Create Anyway." Check availability settings.

### Missing Appointments
- Appointments not showing in the schedule — check filters, date range, provider selection.
- Filters persist between sessions; stale filters are the most common cause.
- If a user reports the schedule is grayed out: check if **availability is set** for the provider. A partially configured availability will gray out the entire calendar outside the set window.
- Check if user is in **All Locations view** vs. a specific location.

### Services Not Appearing in Dropdown
- 🎫 Most commonly caused by **provider-level service configuration**. The service dropdown is filtered by the services assigned to the selected provider. Remove the provider from the appointment temporarily to see the full list; then update the provider's settings if needed.

### Recurrence Problems
- Recurring appointments not generating correctly, or changes to recurrence pattern not applying as expected.
- Confirm whether "this event," "this and following," or "all events" was selected when the change was made. Choosing "all events" also affects past instances.

### Documentation Not Appearing / TO DO List Missing Items
- If a provider can't find their documentation requirements, check that the appointment was properly created and not cancelled.
- ⚠️ Documentation completed from the client chart does NOT fulfill appointment-linked TO DO requirements. The document must be completed through the appointment or TO DO list.
- If a document appears attached to an appointment but is not on the TO DO list: the document may be in "not created" status. The TO DO list shows items for documents that have been started (draft/pending) or are past-due. Check whether the provider has clicked Save on the document at least once.

### Zoom / Video Link Not Added
- 🎫 Provider's Zoom/Teams/Meet account is not connected, or the email in Opus doesn't match the email on the video platform account.
- 🔧 The integration itself requires engineering configuration; confirm it is active for the tenant.

### Units Incorrect on Encounter
- If duration automation is enabled and units seem wrong: confirm the appointment duration (minutes) is set correctly. Units are calculated from duration — setting the correct time is the provider's responsibility.
- If duration automation is not enabled: units always default to 1. Manual override is required on each appointment.
- Units can be corrected retroactively on the appointment or on the encounter in the Billing tab.

### Non-Billable Appointments Appearing in Billing
- ⚠️ Verify the *Billable Service* checkbox is unchecked in **Settings → Services** for that service. If unchecked, encounters may still appear in the **Not Billable tab** (not the main billing queue) — this is expected behavior, not a bug.

### Patient Not Receiving Appointment Confirmation
- Check that **appointment confirmation notifications** are enabled in tenant settings.
- Confirm patient has a valid email/phone on file.
- If a video link was toggled but not received: see Zoom/video troubleshooting above.