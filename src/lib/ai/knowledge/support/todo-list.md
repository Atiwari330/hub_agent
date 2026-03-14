# TO DO List / Task System

## Overview
Clinicians see a TO DO list of required documentation based on their scheduled appointments. Each appointment is linked to specific required documents (e.g., intake assessment, progress note). This is one of the most common areas of support confusion.

The TO DO list lives on the **Homepage** — the first screen users see when they log in to Opus. It is designed to help users keep track of tasks they need to complete, especially regarding documentation within the system.

---

## How It Works

1. An appointment is created in the schedule.
2. Based on the appointment type and configuration, **documentation requirements** are automatically generated.
3. These requirements appear on the provider's **TO DO list**.
4. The provider completes the documentation by clicking through from the TO DO list or from the appointment itself.
5. Once completed, the TO DO item is marked as done.

### Document Status Reference (Critical for Understanding TO DO Behavior)
There are three document statuses in Opus. Understanding these is essential for supporting TO DO issues:

- **Draft** — Document has been started (or saved blank) but not yet completed. Can be saved even if no fields are filled in. TO DO item remains active for the document's creator.
- **Pending** — All required fields are completed but the document is awaiting supervisor review/signature before it can be marked complete. Document automatically flows to the supervisor's TO DO list. **The original user's TO DO item is removed** once saved in pending; it moves exclusively to the supervisor's list.
- **Completed (Complete & Lock)** — Document is finalized and locked. TO DO item is removed. To make changes after completion, the user must unlock the document and provide a reason; this is logged in audit logs.

⚠️ A document is in **"not created" status** (a limbo state) when it is attached to an appointment via the service settings but has not yet been opened and saved in any status. Filtering by "documentation incomplete" on the schedule will flag these appointments even though no document technically exists yet — this causes confusion for users who think a document was auto-created.

---

## Automated TO DO Triggers
The following events **automatically** generate TO DO items (no manual action needed):

1. **Appointment-linked document not started**: If a provider is listed as the **primary provider** on an appointment and the associated service has a document attached, a TO DO item will appear telling the provider to create/complete that document. This appears once the appointment date passes (or for past appointments, it shows immediately).
2. **Document saved in Draft status**: Any document a user has started and saved in draft (not yet completed) will appear in their TO DO list with a "Complete" task.
3. **Supervisee document saved in Pending status**: If a user is marked as the **supervisor** for another user (set on the Providers tab), any document that supervisee saves in pending status will automatically flow to the supervisor's TO DO list for review and signature.
4. **Treatment plan review due**: If an organization has a treatment plan review interval configured (e.g., every 90 days), a TO DO item will appear prompting the user to create a treatment plan review. 🔧 This interval is a backend configuration — it must be set by the engineering team per organization. The next review date field on the treatment plan is separate and can be set manually; Janelle noted she would need to verify with engineering whether setting that date also generates a TO DO notification.

---

## Critical Distinction: TO DO vs. Client Chart
**This is the #1 source of user confusion.**

- The documentation requirement is satisfied ONLY when completed through the **appointment** or the **TO DO list**.
- Creating the SAME document type directly from the **client chart** does NOT fulfill the TO DO requirement.
- Example: A clinician may create an intake assessment from the client chart thinking it fulfills the TO DO requirement, but it doesn't — it creates a **separate, unlinked document**.

### Why This Matters
- The TO DO list tracks what's complete vs. incomplete for each appointment.
- If a document is created from the chart instead of the TO DO/appointment, the system still shows the TO DO item as incomplete.
- This leads to tickets like: "I completed the intake but my TO DO still shows it as pending."
- **Additionally**: Documents created directly from the chart or the Documents tab are not linked to an appointment, which means the appointment date/time does NOT automatically attach to the document. Some clients have complained about this — "I created a document for this appointment, why can't I see the appointment?" — because it was not created through the appointment.
- **Workaround if a user accidentally created a document from the chart**: They can go to the appointment, click "Attach document," select "existing document," and attach the previously created one. This links it retroactively.

---

## TO DO List Interface and Permissions

### Viewing Other Users' TO DO Lists
- Users with the **"Can See All To Dos"** permission (set in Roles & Permissions → Other Permissions) can use the **Assigned To** filter on the TO DO list to view any other user's TO DO list.
- This is typically reserved for admin users.
- 🎫 If a user reports seeing tasks on their TO DO list that don't belong to them, check their supervisor settings on the Providers tab and their role permissions — they may have unintended supervisor relationships or "Can See All To Dos" enabled.

### Completing a TO DO Item Without Completing the Document
- There is a separate **"Can Complete To Dos"** permission (Roles & Permissions → Other Permissions).
- If this is turned on, a **Complete** button appears next to each TO DO item, allowing the user to mark the task as done even if the underlying document has NOT been completed.
- **This is typically turned OFF for clinicians** to ensure they cannot bypass documentation requirements.
- It is typically turned ON for admin users who may have tasks assigned to them that are not relevant to complete.

### Adding Manual TO DO Items
- Users can manually add free-text TO DO items on the Homepage. These work similarly to a task list (like Asana) and can be marked complete manually once done.
- These manual items are completely independent of appointments and documentation.

### Bulk Completing Documents from the TO DO List
- Users can select multiple TO DO items using checkboxes and click **"Complete selected documents"** to open the bulk completion view.
- From the bulk view, supervisors can use **Sign Documents** → choose the signature field → review → click **Sign All** to bulk sign pending documents.
- Only documents already in **pending status** can be bulk completed through this flow; documents in "not created" or "draft" status must be individually updated first.

---

## Common Issues in Support Tickets

### 🎫 "I completed the document but TO DO still shows incomplete"
- Almost always: the user completed the document from the **client chart** instead of from the **TO DO list or appointment**.
- This is a **training issue**, not a bug.
- Resolution: Explain the correct workflow — documents must be opened from the TO DO list or appointment to fulfill the requirement. If the document was already created from the chart, offer the workaround: open the appointment → Attach Document → select the existing document.

### 🎫 "Duplicate documents"
- Often caused by completing a document from both the chart AND the TO DO list.
- The chart-created document is standalone; the TO DO-linked one is the correct one.
- The chart-created document can be left in its current state or deleted (deleted documents can be restored from Settings → Deleted Data).

### 🎫 "TO DO items not appearing"
- Check that the appointment exists and hasn't been cancelled.
- Check that the provider is listed as the **primary provider** on the appointment — TO DO items are only generated for the primary provider.
- Check the appointment type/service and whether it has documentation requirements configured (Settings → Services).
- Check that the service is set up with a document attached in the service settings.
- ⚠️ If the appointment is in the future, the TO DO item may not appear yet until the appointment date passes (or on the same day depending on configuration).

### 🎫 "Wrong forms showing on TO DO list"
- Check the appointment type configuration — the required forms are tied to the appointment/service type (Settings → Services → select service → Documents section).
- Multiple documents can be attached to a single service. Verify the correct documents are listed there.

### 🎫 "Tasks are showing on random people's TO DO lists"
- The only tasks that should appear on a user's TO DO list are:
  1. Documents they started and haven't completed (draft/pending)
  2. Documents associated with appointments where they are the **primary provider**
  3. Documents their supervisee saved in pending status (if they are set as the supervisor)
- Most likely cause: **supervisor settings** are misconfigured on the Providers tab. Check who is set as the supervisor for the affected user.
- Secondary cause: The user may have the "Can See All To Dos" permission enabled unintentionally.

### 🎫 "Document came back from the patient portal but I can't find it on my TO DO list"
- This depends on the document return status setting in Patient Portal settings:
  - **Draft** → document returns to the TO DO list of whoever sent it (intake coordinator, typically) for review and completion.
  - **Pending** → document goes to the *supervisor's* TO DO list of whoever sent it. ⚠️ This can cause confusion if they have supervisor settings active — Janelle recommends avoiding this setting for portal documents.
  - **Completed** → document is marked complete automatically; it does NOT appear on anyone's TO DO list. Use this if no review is needed.
- 🎫 Janelle specifically **recommends Draft** if the organization wants to review portal-submitted documents, because returning in Pending can cause unexpected routing to supervisors.

### 🎫 "Intake coordinator completed the document but provider/clinician never gets to review it"
- ⚠️ **Known limitation**: There is no native way to route a document from an intake coordinator directly to an assigned provider's TO DO list. The routing via TO DO is:
  - Intake sends to portal → portal document returns → lands on intake coordinator's TO DO (if draft) or supervisor's TO DO (if pending).
  - There is no workflow today that routes a portal-completed document to the primary provider's TO DO without that provider also being the supervisor.
- Workaround: The intake coordinator can manually tag the provider using the **Notes** section on the document to notify them to review.

### 🎫 "TO DO still shows after I saved in Pending"
- Once a document is saved in pending, it moves to the **supervisor's** TO DO list, not the user's. The user's TO DO item should disappear.
- If it's still showing: verify the user is properly linked to a supervisor in the Providers tab. If no supervisor is set, the document may stay on the user's list.

### 🎫 "TO DO item for treatment plan review appeared unexpectedly"
- This is triggered by the backend configuration for treatment plan review intervals (e.g., 90 days after a treatment plan is completed).
- 🔧 This interval is set per organization by the engineering team. If a customer is seeing unexpected review reminders or wants to change the frequency, it requires an engineering configuration change.

---

## Supervisor Signature Workflow via TO DO
This is a common workflow for organizations with supervisory requirements:

1. Supervisee completes a document and saves it in **Pending** status (requires all required fields to be complete).
2. Document automatically appears on the **supervisor's TO DO list**.
3. Supervisee's TO DO item is removed once moved to pending.
4. Supervisor reviews the document from their TO DO list.
5. Supervisor can add comments/tags using the **Notes** section on the right side of the document to communicate back to the supervisee if changes are needed (without changing document status themselves).
6. Supervisor adds their signature and marks the document as **Completed** → document is locked and removed from the TO DO list.

**Efficient supervisor workflow**: Supervisors can go to the Documents tab, toggle on **"Show only my supervisees pending documents"**, select all pending documents using the checkboxes, and bulk sign/complete in one flow. This is the most commonly used workflow for supervisors with large caseloads.

---

## Additional Context: Groups and TO DO List
- For group sessions, a progress note (or other configured document) is generated **per participant** — not one shared note.
- Each of these per-participant documents will appear on the provider's TO DO list if not completed.
- Providers can use the **Group Notes** bulk view (Groups tab → three dots → Group Notes) to copy content between participants, bulk sign, and bulk complete to efficiently clear TO DO items for group sessions.

---

## Related Settings and Configurations

### Roles & Permissions (Settings → Roles & Permissions)
- **Can See All To Dos**: Allows the user to view other users' TO DO lists via the "Assigned To" filter.
- **Can Complete To Dos**: Allows the user to mark a TO DO item as done without completing the underlying document.

### Service Configuration (Settings → Services)
- Each service can have one or more documents attached. These are what auto-generate on the TO DO list when an appointment of that service type is created.
- 🔧 **Duration automation** (units auto-calculated from appointment duration) must be enabled by engineering per service if needed. This does not affect TO DO behavior but is related to service setup.
- Services can be marked **non-billable** — these still generate TO DO items if they have attached documents, but they do not flow to the billing tab.

### Provider Settings (Providers Tab)
- The **Supervisor** field on a provider's settings page determines whose TO DO list receives their pending documents.
- ⚠️ If supervisor is not set, pending documents will NOT automatically route to anyone — they stay in a limbo state visible only in the Documents tab.

### Patient Portal Settings (Settings → Patient Portal)
- Controls what status documents come back in when a patient completes them (Draft / Pending / Completed).
- Directly determines whose TO DO list receives portal-returned documents.

---

## Known Limitations and Gotchas

- ⚠️ **No cross-provider routing**: There is no way to route a TO DO item to a specific provider other than through the primary provider on the appointment or the supervisor chain.
- ⚠️ **Group session per-patient notes**: Unlike some other EHRs, Opus requires a separate completed note per group participant. Providers cannot complete one note for the whole group.
- ⚠️ **"Not created" document limbo state**: Documents attached to services show as "documentation incomplete" on the schedule even before they've been started. This is expected behavior, not a bug.
- ⚠️ **One patient, one location**: A patient can only exist in one location at a time. Providers at a different location cannot see that patient's chart or generate TO DO items for them. If a patient transfers, the **Move Patient** feature should be used.
- ⚠️ **No Google Calendar / Outlook sync**: The Opus schedule does not integrate with personal calendar apps. TO DO items and appointments live exclusively inside Opus.
- 🔧 **Treatment plan review notifications**: The exact behavior of TO DO generation from treatment plan review dates requires confirmation with engineering; the next review date field on the treatment plan form may or may not auto-generate a TO DO item depending on tenant configuration.
- ⚠️ **Notification settings ambiguity**: The notification settings panel (Settings → Notifications) controls some TO DO-adjacent behaviors (e.g., pending documents, next review treatment reminders) but is acknowledged internally as not fully documented. For complex notification routing needs, escalate to engineering. A more comprehensive knowledge base article on notifications is pending.