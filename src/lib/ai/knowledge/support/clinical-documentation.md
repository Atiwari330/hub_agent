# Clinical Documentation — Forms & Templates

## Overview

Opus EHR provides clinical forms and templates for documenting patient encounters. These include intakes, assessments, progress notes, and other clinical documents. Understanding how templates work is important for both support and configuration questions.

**Terminology note**: In Opus, the terms **form**, **document**, and **assessment** are used interchangeably. Unlike some other EHR platforms where these may represent distinct object types, in Opus they all refer to the same underlying structure. Support agents should not treat these as different things when a user mentions them — they are the same. This is a frequent source of confusion for users migrating from other EHRs.

---

## Types of Clinical Documents

- **Intake Assessments**: Initial evaluation documents completed at the start of care.
- **Progress Notes**: Session-by-session documentation of clinical encounters.
- **Treatment Plans**: Ongoing care plans that outline goals and interventions. ⚠️ These are a distinct document type with special behavior — see the Treatment Plans section below.
- **Assessments**: Various clinical assessment tools and questionnaires.
- **Discharge Summaries**: Documentation when a patient ends care.
- **Release of Information (ROI) Forms**: Consent documents authorizing disclosure of patient information. These live in their own dedicated section (not the standard Documents section) and carry a special ROI status tied to expiration date. See ROI section below.
- **Uploaded Documents**: External files (e.g., scanned PDFs) can be uploaded directly into the patient chart. These appear the same as built forms but open as PDFs. They can be saved in draft, pending, or completed status like any other document.
- **Doctor Order Forms**: A separate form type configured in Settings. Referenced in treatment plan workflows; covered more in the medications module.

---

## Document Status: Draft, Pending, and Completed

Understanding document status is critical — it controls workflow routing, to-do list behavior, and supervisor notifications.

### Draft
- A document can be saved as **Draft** at any point, even if it is blank or partially completed.
- Draft status = document has been started but not yet finalized.
- Draft documents appear on the **creating user's To Do list** until completed.
- 🎫 Users often confuse "draft" with "incomplete." Clarify that draft is a deliberate holding state, not an error.

### Pending
- **Pending** is used when a document is complete but requires supervisor review/signature before being finalized.
- ⚠️ A document **cannot** be saved as Pending unless **all required fields are filled out**. This is a common reason users get stuck — they cannot move to Pending and may not realize a required field is empty.
- When saved as Pending:
  - The document is **removed from the creating user's To Do list**.
  - It is **automatically routed to the supervisor's To Do list** (based on supervisor settings configured on the Providers tab).
  - The supervisor can review, add a note/tag, and either sign/complete or communicate corrections back to the user.
- 🎫 Common confusion: Users ask why a document disappeared from their To Do list after saving as Pending. This is expected behavior — it has moved to the supervisor's list.
- ⚠️ If supervisor settings are not properly configured (supervisor not assigned to the provider on the Providers tab), pending documents will not route correctly.
- 🎫 Known workflow friction: If a supervisor wants to send a document back for corrections, there is no formal "reject" action. The recommended workaround is to use the **Notes/tag** feature on the right side of the document — the supervisor tags the clinician with a comment explaining what needs to be fixed, and the document stays in pending. The clinician makes corrections and re-saves. There is a known request to add additional status options (e.g., for in-progress back-and-forth) — this is a roadmap item.
- ⚠️ Do not recommend saving documents in Pending as a default portal return status. If a portal document comes back in Pending and the sending user has a supervisor, it will flow to the supervisor's To Do list unexpectedly. Recommended portal return status is **Draft** (if review is needed) or **Completed** (if no review needed). See the Portal section for more.

### Completed
- Marks the document as finalized and **locks it from editing**.
- Once completed, the document shows as locked. To make changes, a user must click the three dots → **Edit** → **Unlock**, provide a reason for unlocking, make changes, and re-save.
- ⚠️ The unlock action and the reason provided are **saved to the audit logs**.
- Completing a document removes it from the To Do list automatically.
- 🔧 Whether users can unlock completed documents may depend on role/permission settings.

---

## Templates

### How Templates Work
- Clinical forms are built from **templates** that define the structure and fields.
- Templates can be customized per organization to match their clinical workflows.
- Different appointment types can be configured to require different templates.
- Templates are built in the **Form Builder** (Settings → Documents and Forms → Form Builder). The Form Builder is the global library of all form templates for the tenant.
- ⚠️ **Template changes affect future documents only** — existing completed documents retain their original template version.
- In the Form Builder, the folder a form belongs to (which determines where it appears in the patient chart) is set either in the Form Builder itself or via **Patient Menu Structure** in Settings.

### Creating / Editing Templates
- Templates define what fields, sections, and questions appear in a clinical document.
- Template editing requires administrative access.
- ⚠️ Deleting a form from the Form Builder **permanently removes it from the entire tenant**. Recommend clients **turn forms off at the location level** rather than delete them from the Form Builder unless they are 100% certain they will never need them.
- After creating or editing a form, **always refresh the browser before using the form** — changes may not be visible in the patient chart until a refresh.
- 🔧 Some form types (particularly treatment plans) contain engineering-configured components not available through the standard Form Builder UI. These require a backend configuration request.

### Form Builder: Components Reference

The Form Builder is a drag-and-drop interface. Components are dragged from the left panel into the form workspace. The right panel shows form-level settings (name, folder, instructions, OMT toggle, etc.).

**Text-type components:**
- **Text** — Static display text on the form. Used for instructions, paragraphs, ROI boilerplate, etc.
- **Text Input** — Short-answer text field. Options include: placeholder text (grayed out hint), default value (pre-filled text), required toggle, min/max character length, patient portal editability, exclude from "load from last result," and predefined responses.
- **Text Area** — Same as Text Input but displays as a larger box. Appropriate for SOAP note fields, long narratives. Height is adjustable (min/max).
- **AI Autofill (Text Input variant)** — Connects to **Copilot** (AI transcription/note feature). Has a field selector for one of 36 Copilot note components. ⚠️ The Copilot field selected in the form builder must match the correct Copilot output section. Mismatch = no data populates. This is a common setup issue. If a form is not being used with Copilot, this component behaves identically to a standard text input.

**Choice components:**
- **Single Choice** — Radio button style; user selects one answer. Options: show inline, reorder choices, collections, visibility conditions.
- **Multiple Choice** — Checkbox style; user selects multiple answers. ⚠️ The naming can be confusing — "multiple choice" in Opus means checkboxes (select many), not the standard academic usage. Appropriate for symptom lists, etc.
- **Dropdown** — Select from a list. Can be configured to allow multiple selections, set a max number of selected items, and use a Collection. ⚠️ **Known limitation**: When a dropdown with multiple selections is printed or downloaded, the output appears as a comma/tab-separated running sentence, not a bulleted list. 🔧 Changing this formatting requires an engineering change request. This has been a support issue (specifically flagged by ATC).
- **Hide in View Mode** option on dropdown: Hides the field when the form is in view/read-only mode. Rarely used. ⚠️ Flagged as something that's caused internal confusion (e.g., ATC). Only use when there is a clear reason to hide a field from patient-facing views.

**Other input components:**
- **Date Picker / Time Picker** — Formats input as a date or time value.
- **Number Input** — Numeric entry only.
- **Email Input** — Validates email format. ⚠️ Janelle notes she does not always recommend using this because validation can incorrectly reject valid entries.
- **Phone Input** — Validates phone number format. ⚠️ Same caveat as email — can be overly strict and reject valid numbers.
- **Password Input** — Rarely used in clinical forms.

**Signature fields:**
- **Signature** — Can be configured as:
  - **User** — Shows the logged-in user's name and the date.
  - **Patient** — Shows the patient's name automatically.
  - **General** — Prompts manual name entry. Used for guardian, witness, or other non-user/non-patient signers.
- Multiple signature fields can be added to a single form.
- Date on the signature line can be set as editable or locked.
- Users set their signature once on first login; thereafter it is one-click to sign.

**Form-level settings (right panel):**
- **Form Name** — Display name.
- **Module Size** — Rarely needs adjustment; controls display size.
- **Folder** — Which folder in the patient chart this form appears in. Relates to Patient Menu Structure.
- **Document Instructions** — Rich text field. Instructions appear on the form but are NOT part of the clinical document content. Most commonly used for assessment scoring guides.
- **Show OMT Button** — Toggle for whether this form's score appears in the Outcome Measurement Tools (OMT) tab. Enable for scored assessments. ⚠️ There is a system limitation: **only one assessment score can be displayed at a time** in OMT. If a patient needs multiple distinct assessment scores tracked, use Form Groups to bundle them.

**Visibility Conditions:**
- Any component can be set to appear or hide conditionally based on the answer to another component.
- Common use: Show an "Other — please specify" text input only when the user selects "Other" in a dropdown or single-choice field.

**Collections:**
- Predefined option lists that can be reused across multiple questions and forms.
- Created in Settings → Documents and Forms → Collections.
- When a collection is assigned to a question, the options populate automatically.
- Best for lists that appear in multiple places — avoids re-entering the same options repeatedly.

**Predefined Responses (Text Input / Text Area):**
- Two levels:
  1. **User-level**: Any user can save a value from the three-dot menu on a text field while completing a form. This saves only for that user on that specific field.
  2. **Form-level (global)**: Set up in the Form Builder under Predefined Responses. These are visible to all users filling out the form. Used by organizations (e.g., True North) to provide shared clinical language/phrases.

---

## Document Completion Workflow

1. An appointment is created in the schedule.
2. The **To Do list** (Home tab) shows required documents based on the appointment type and service configuration.
3. The clinician opens the document from the To Do list or appointment.
4. They fill in the clinical information.
5. The document is saved in **Draft** (in progress), **Pending** (awaiting supervisor), or **Completed** (finalized and locked).
6. The completed document is stored in the client chart.

### Helpful In-Form Features During Documentation

- **Save Value / Load Value** (three-dot menu on a text field): Allows a user to save a phrase for personal reuse on that specific field. Persists across sessions. Scope is user-specific and field-specific — does not appear on other fields or forms.
- **Load from Last Result** (Options menu at top of form): Populates the current form with values from the last completed version of the same form for that patient. Useful for recurring notes. Individual fields can be excluded from this load via the Form Builder setting.
- **Copy Content / Paste Content**: Allows copying the contents of one form and pasting into another (same or different template). Particularly useful for group sessions.
- **Note/Tag Panel** (right side of open document): Allows users to tag other users (generates notification) and add internal notes that do not appear on the clinical document itself. Used for supervisor-clinician communication about documents in progress.
- **ICD Code Tab** (within open document): Allows adding diagnosis codes directly to the patient's chart from within the document view.
- **Allergies Tab** (within open document): Displays allergies on file; allows adding a new allergy from within the document.
- **OMT Tab** (within open document): Shows Outcome Measurement Tool data for the patient, including graphs when multiple scores exist.
- **AI Summary** (view mode): A new AI-generated summary of the note available in view mode. ⚠️ May not be in all tenants yet.
- **Share Document** (three-dot menu): Share a read-only OR editable version directly to the patient's portal. Editable version is appropriate when a patient needs to fill out fields.
- **Upload** (within open document or from chart): Upload a file from the user's computer and save it as a document in draft, pending, or completed status.
- **Download / Print** (view mode → upload button): Download or print the document as a PDF.

---

## Where Documents Can Be Created

- **From the To Do list / Appointment** — This is the **CORRECT** way to fulfill appointment-linked requirements. When a document is created from an appointment, the appointment's date/time is automatically linked to the document.
- **From the Client Chart (Documents section)** — Creates a standalone document that does **NOT** fulfill any To Do requirement and is **NOT** automatically linked to an appointment. Appropriate for ad-hoc documentation not tied to a specific appointment (e.g., a general letter, miscellaneous note).
- **From the Document Archive (Documents tab)** — Using the **Express Document** button creates a document and links it to a patient, but again does not fulfill an appointment-linked To Do. ⚠️ If a user accidentally creates an appointment-linked document from the archive instead of the appointment, they can manually attach it: open the appointment on the schedule → Attach Document → select the existing document.
- 🎫 **Common complaint**: Users report that a document "doesn't show the appointment" or "isn't linked." This is almost always because the document was created from the chart or archive rather than from the appointment itself. Educate users to create appointment-related documents from the appointment view.

---

## Patient Chart: Document Folder Structure

- All documentation for a patient lives on the left side panel of the patient chart, organized into **folders**.
- Folder structure is fully customizable in **Settings → Patient Menu Structure**.
- Folders can be added, renamed, and reordered. Forms can be dragged between folders.
- The patient chart folders are essentially like a filing cabinet — folder names are not document names. For example, uploading a file into the "SOAP Notes" folder does not make it a SOAP note; it just lives in that folder.
- A form built with no fields (a **blank form**) creates a folder-like section that only shows an **Upload** button (no New button). This is used for sections like "Scanned Documents" or "Miscellaneous Files."

---

## Treatment Plans

Treatment plans are a **distinct document type** from standard forms. They share the same underlying Form Builder infrastructure but have additional behaviors.

### What Makes Treatment Plans Different
- Stored in their own **Treatment Plans** section in the patient chart (not in the Documents section).
- Can pull in **diagnosis codes** from the patient's chart automatically.
- Can reference data from diagnostic assessments completed for the patient.
- Have a **Next Review Date** field at the top of each treatment plan.
- Support a **Review/Update workflow** via the three-dot menu → **New Review**.
- Trigger **To Do list notifications** for review reminders based on org-level configuration.
- Often contain engineering-configured components not available in the standard Form Builder (e.g., complex goal/objective sections).

### Treatment Plan Review Workflow
1. Complete the initial treatment plan; set a **Next Review Date** if desired.
2. 🔧 Organizations can configure a backend setting (e.g., 90 days) after which a **To Do list item** is generated prompting a new review. This does not auto-create the document; it just creates the prompt.
3. To create a review: open the original treatment plan → three-dot menu → **New Review**. The review form auto-populates from the original treatment plan content, allowing the clinician to update progress without altering the original document.
4. Each review appears as a **bullet point nested under** the original treatment plan, keeping all reviews connected in one visual thread.
- ⚠️ The review date notification logic (whether it's based on the creator, primary provider, or review date field) is not fully documented internally. 🔧 For notification configuration questions, engage the engineering team.
- 🔧 **Default Treatment Plan** can be set per location in Settings → Location → default treatment plan. This pre-selects a template when users navigate to create a treatment plan.

### Treatment Plan Signatures
- Any number of signature lines can be added.
- Users click **Use My Signature** for one-click signing (signature saved from first login).

---

## Release of Information (ROI) Forms

- ROI forms live in their own **ROI section** of the patient chart, separate from standard Documents.
- The ROI form builder is functionally the same as the standard Form Builder, but the form always includes a **mandated header section** (including expiration date) that auto-populates.
- **ROI status** is automatically calculated based on the expiration date set on the form (e.g., if the expiration date has passed, status shows as "Expired").
- ⚠️ The expiration date is a **required field** on ROI forms. If users ask to remove it: in most US states, an ROI is only valid for up to one year and this is a legal/HIPAA-compliance requirement — not an arbitrary system constraint.
- **Revoke** option (three-dot menu on ROI): Changes the ROI status to "Revoked." Can be reactivated. Full implications of revoking vs. just letting it expire are ⚠️ not fully documented — escalate to engineering if a client has specific workflow questions about this.
- 🎫 Users sometimes ask why the expiration date is required or ask to remove it. Reference HIPAA/state law compliance. Most ROIs are only valid for one year.

---

## Form Groups

⚠️ **Form Groups are NOT related to group therapy sessions.** This is a very common point of confusion.

- **Form Groups** (Settings → Documents and Forms → Form Groups) allow bundling multiple individual forms together into a single structured unit.
- When a user opens a Form Group, they see all the included forms in a single view, similar to the bulk document view.
- Use case: An intake packet that includes a demographic form, consent form, assessment, and treatment history — grouped together so a user can complete them all in one session without navigating between individual forms.
- Each document within a Form Group can still be saved individually in draft, pending, or completed status.
- 🎫 Known edge case: The behavior of a Form Group's overall status when some component documents are completed and some are not is **not fully documented** — the exact logic has been flagged as a knowledge gap by the implementation team.
- Another use case: Bundling multiple assessments together when distinct OMT scores are needed for each (since OMT can only display one assessment score at a time on a single form).

---

## Document Packages (Patient Portal)

- **Document Packages** (Settings → Documents and Forms → Document Packages) are bundles of forms used **strictly for sending to the patient portal**.
- They are NOT Form Groups and are NOT used in the EHR clinical workflow directly.
- A package can contain any number of forms. When sending to the portal, a user selects the package name and all included forms are sent in one action.
- Typical use case: "Intake Package" containing all onboarding documents a new patient must complete before their first appointment.
- 🎫 Common question: Users sometimes confuse Document Packages with Form Groups. Key distinction — Document Packages = portal delivery bundles. Form Groups = multi-form clinical workflow bundles within the EHR.

---

## Document Archive (Documents Tab)

The **Documents tab** (left navigation) is the organization-wide view of all clinical documentation across all patients.

### Key Features
- **Search**: Filter by document name across all patients.
- **Filters**: Status (draft, pending, completed), created by, date range, patient, and more. Filters can be stacked.
- **Show My Patients Only**: Filters to only show patients within the logged-in user's caseload (if caseloads are in use).
- **Show Only My Supervisees' Pending Documents**: Supervisor-specific filter. Shows all documents saved in pending by the supervisor's supervisees. The primary workflow for supervisors doing bulk review and sign-off.
- **Bulk Operations**:
  - Select multiple documents → **Edit** → bulk view similar to group notes.
  - **Complete selected documents** → bulk completes and locks documents. ⚠️ Only documents already in Pending status can be bulk-completed this way.
  - **Sign documents** → supervisor bulk-signs selected documents from the settings button.
  - **Download All / Print All** → bulk download or print selected documents as PDFs. Documents can be reordered before downloading.
- **Bulk Portal Request**: Select multiple patients → send specified forms to all their portals at once. Can also send to all active patients (e.g., a holiday closure letter).
- **Express Document**: Create a new document for any patient directly from the archive. ⚠️ This does NOT fulfill a To Do or appointment requirement.
- Document sort order in bulk view is based on created date (ascending).

---

## To Do List

The **To Do list** (Home tab, center panel) is the primary task management interface. Key automations:

- **Unstarted appointment documents**: If a provider is the primary provider on an appointment and the required documentation has not been started, it will appear on their To Do list.
  - Note: A document is in "not created" status until the user clicks on it and saves it (even in draft). The To Do item prompts the user to begin.
- **Draft/pending documents**: Any document the user has saved in Draft status will stay on their To Do list until completed.
- **Supervisor queue**: When a supervisee saves a document in Pending, it appears on the supervisor's To Do list.
- ⚠️ Documents that come back from the patient portal in **draft** status will appear on the **sending user's** To Do list for review. Documents that come back in **pending** will go to the **supervisor's** To Do list. Documents that come back in **completed** go directly to the chart with no To Do notification.

### To Do List Permissions
- **Can Complete Todos**: Role permission. If enabled, users see a "Complete" button next to a To Do item that lets them mark it done even without completing the underlying document. Used mainly for admin users managing non-clinical tasks.
- **Can See All Todos**: Role permission. If enabled, a user can switch the "Assigned To" filter and view any other user's To Do list. Used by admins and supervisors.
- 🎫 Known issue: If tasks appear on the wrong user's To Do list, the most likely cause is a misconfigured supervisor relationship on the Providers tab. The only items that should appear on a user's To Do list are: (1) documents they started and haven't completed, (2) documents tied to appointments where they are the primary provider, and (3) documents their supervisees saved in pending.

### Manual To Do Items
- Users can add free-text manual To Do items (similar to a personal task list). These are completed manually from the To Do list and do not create clinical documents.

### Bulk Complete from To Do
- Same bulk complete and sign workflow as the Document Archive is available directly from the To Do list. Supervisors can bulk-sign all supervisee pending documents from here.

---

## Group Session Documentation

- In Opus, each participant in a group session requires their **own individual progress note** — unlike some EHRs that allow a single note for the group.
- Group notes are accessed from: Schedule tab → group session → three-dot menu → **Group Notes**, or from the **Groups tab** → three-dot menu → **Group Notes**.
- Forms associated with a group session are determined by the **service type** assigned to the group (set via Settings and Services).
- **Copy Content / Paste Content**: Content from one participant's note can be copied and pasted into another participant's note, then modified. This is the primary tool for efficient group documentation.
- **Bulk Sign**: From the group notes view, click Settings → **Sign Documents** → select the signature field → scroll through and sign all.
- **Bulk Complete**: Click **Complete Documents** → select documents in pending status → complete all. ⚠️ Only documents already in pending status can be bulk-completed.
- 🎫 Per-patient additional forms (e.g., a suicide watch form for a specific group member): These cannot be auto-triggered per patient within a group. A clinician must manually **Attach Document** to that specific participant's entry in the group session. This is not automated.
- 🔧 **Default Group Session Service** can be set per location (Settings → Location) to pre-populate the service type when scheduling a group.

---

## Common Issues in Support Tickets

### "Template not showing the right fields"
- Check the template configuration for that document type.
- Verify the correct template is assigned to the appointment/service type.
- ⚠️ If form was recently updated, the user may need to refresh their browser.

### "Can't edit a completed document"
- Once signed/finalized, documents are locked. Users must unlock via three-dot menu → Edit → Unlock, and provide a reason.
- The unlock reason is saved to audit logs.
- 🔧 The ability to unlock may be restricted by role/permission settings.

### "Document not saving"
- Check for required fields that haven't been completed (most common cause).
- ⚠️ A document cannot be saved as Pending if required fields are empty.
- Check connectivity / session timeout issues.

### "Wrong template assigned to appointment type"
- This is a configuration issue — the appointment type's required forms need to be updated in Settings → Services.

### "My document isn't linked to the appointment"
- The document was likely created from the patient chart or Document Archive, not from the appointment directly.
- Workaround: Open the appointment on the Schedule → **Attach Document** → select the existing document.

### "A document disappeared from my To Do list"
- If the user saved it as Pending, it moves to the supervisor's To Do list. Expected behavior.
- If Completed, it is removed from the To Do list upon locking.

### "Pending document went to the wrong supervisor (or no supervisor)"
- Supervisor assignments are managed on the **Providers tab**. Verify that the correct supervisor is assigned there.

### "Dropdown selections print as a run-on sentence, not a list"
- 🔧 This is a known formatting limitation. The output of multi-select dropdowns in print/download mode is comma/tab-separated. Changing this to a bulleted format requires an engineering change request.

### "Form Group status is unclear when not all documents are completed"
- ⚠️ The logic for how a Form Group's aggregate status is determined when only some component documents are completed is **not fully documented**. This is a known knowledge gap. Escalate to the engineering team if a client reports unexpected behavior.

### "Copilot isn't populating the right fields"
- Opus Copilot AI is powered by **Nabla**, a third-party AI transcription/note platform that Opus is an authorized reseller of.
- The form must use the **AI Autofill** component (not a standard text input) for Copilot to populate a field.
- The specific Copilot field selected within that component must match the correct Copilot output section.
- Nabla provides a set of **canned clinical sections** it can populate, including: chief complaint, history of present illness (HPI), medications, assessment, plan, symptoms, social history, and others (36 total). Customer forms often use different naming or split sections differently (e.g., social history across two form sections). Mapping customer form fields to the correct Nabla output section requires **clinical documentation expertise**.
- ⚠️ Field labels in the form may not exactly match Copilot's section names — this requires careful mapping during setup.
- 🔧 **Copilot/Nabla configuration is NOT a support agent task.** This must be coordinated with the implementation/onboarding team (Saagar's team), who have the clinical section expertise to correctly map customer form fields to Nabla's output sections. If a support ticket involves Copilot form setup or configuration, the support team should connect internally with Saagar's team for guidance on the mapping — do not attempt this independently.

### "ROI won't let me remove the expiration date"
- The expiration date is required. This is by design and aligns with HIPAA/state law compliance (most states require ROIs to have an expiration of one year or less).

### "Phone/email field won't save even with valid data"
- Known limitation: the phone and email input components use validation that can be overly strict.
- Workaround: Use a standard **Text Input** component instead for phone/email fields on that form. Escalate to engineering if the client requires strict validation.

### "Users have random documents on their To Do list"
- Check supervisor settings on the Providers tab. The most common cause is an incorrectly configured supervisor relationship, causing documents to route to the wrong person.
- Other possibility: the user has the "Can See All Todos" permission and is viewing another user's list.

### "AI Summary not appearing on a document"
- ⚠️ The AI note summary feature may not be enabled for all tenants. Escalate to engineering to confirm if it is available for that tenant.