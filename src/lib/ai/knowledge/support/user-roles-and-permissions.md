# User Roles & Permissions

## Overview

Opus EHR uses a role-based permission system that controls what users can see and do. Many support tickets about missing tabs, inaccessible features, or restricted patient visibility trace back to role configuration.

Roles are **fully customizable per customer**. During implementation, Janelle (Implementation Specialist) typically provides customers with a set of default roles as a starting point. Customers can modify those defaults or create entirely new roles at any time. There is no system-wide default role template enforced by Opus — what appears in the demo environment is for demo/testing purposes only and may not reflect a real customer's setup.

**Recommended setup order for new implementations:**
1. Create and configure all roles (Settings > Roles & Permissions)
2. Add users and assign them roles (Settings > Users)
3. Add users as Providers on the Providers tab
4. Configure supervisor assignments on each Provider record

---

## Creating and Editing Roles

- Roles are created and managed in **Settings > Roles & Permissions** by administrators.
- Each role defines a set of permissions that control access to features, tabs, and data.
- To edit an existing role, click the **green pencil icon** next to the role name.
- 🎫 There is no role inheritance or templating system — each role is configured independently.
- ⚠️ Changes to a role apply immediately to all users assigned that role. There is no staging/preview.
- After making changes in Settings, **always recommend a screen refresh** in the EHR for changes to take effect.

---

## Permission Categories

### General Access
Controls access to the **left-hand navigation tabs** and the **top-right corner buttons**. Each toggle maps directly to a tab or UI element.

| Permission Toggle | What It Unlocks |
|---|---|
| Scheduler | Schedule tab |
| Patients | Patients tab |
| Documents | Documents tab (document archive) |
| Mars | MARS tab |
| Caseload | Caseload tab |
| Configuration | Settings page (see Configuration Access section) |
| Patient Messages | Messaging button (top-right) |
| E Prescribe | E Prescribe tab |
| Occupancy Room Access | Occupancy tab + room/bed visibility control |
| Patient Requests | Patient Requests tab (left nav) |

- 🎫 **"I can't see a tab" is almost always a General Access role issue.** Check which role the user is assigned and which tabs that role has enabled.
- ⚠️ A second possible cause of missing tabs: the user is in the **All Locations view**. In All Locations, only these tabs are available: **Patients, Documents, Schedule, Groups, Billing**. All other tabs are location-specific (Mars, Occupancy, etc.) and will not appear in the All Locations view. This is by design, not a bug.

### Patient Permissions
Controls what a user can do within a patient's chart.

- **Can create new patient** — controls whether the user sees the New Patient button
- **Can see Social Security number** — SSN is hidden unless this is explicitly on
- **Can see patient billing information** — controls visibility of billing-related data in the patient chart
- **Can see patient calendar** — controls access to the patient calendar sub-tab
- **Can manage new patient requests** — controls whether the user can accept incoming patient portal requests and create the patient record in the EHR
- **Can edit charged events** — controls whether a user can modify an appointment after it has already been synced to RCM. Should typically be off for most users.
- **Can edit all notes** — controls whether the user can edit documentation created by someone else

### "Can see all patients, not only those on user's caseload"
- When **off**, users only see patients assigned to their caseload.
- When **on**, users see all patients in the location.
- Typically **off** for clinicians and case managers, **on** for intake coordinators and billing staff.
- 🎫 This is the first thing to check when a user reports they cannot find a specific patient or their patient list looks incomplete.
- ⚠️ This permission is location-scoped. If a user has access to multiple locations, visibility still depends on the location they are currently browsed into. Verify the user is looking at the correct location, not the All Locations view.

### Configuration Access
- Controls whether a user can access Settings and individual configuration sections.
- Each settings section is individually toggleable. For example:
  - **Locations** on → user can create/edit locations
  - **Forms** on → user can access the form builder
  - **Users** on → user can create/edit other users
  - **Services** on → user can edit services
  - **Medications** on → user can edit medication settings
- Should be limited to administrators. In practice, some customers give specific non-admin users partial settings access (e.g., head of nursing gets Medications access, billing staff gets Services access).
- 🔧 **Places of Service** cannot be created or edited through Settings by end users — this is a backend configuration performed by the engineering team. Customers must submit a request to have places of service added or changed.

### Document Permissions
- Configured per document type, per role.
- Access levels (from least to most):
  1. **None** — user cannot see the document type at all
  2. **Read** — user can view the document but cannot create or edit
  3. **Create and Edit** — user can create and edit but cannot mark completed; requires supervisor sign-off to finalize
  4. **Complete and Unlock** — full access; user can mark documents completed and unlock them for edits after completion
- ⚠️ If a user is set to Create and Edit only (not Complete and Unlock), they will not be able to finalize documents. This is intentional for supervisee workflows — the supervisor must complete the document. This is a common source of confusion for users who cannot figure out why they can't mark their own notes complete.
- 🎫 "I can't complete/lock my document" = check the user's document permissions for that document type.

### Other Permissions
- **Can see all to-dos** — allows the user to view other users' to-do lists via the "Assigned To" dropdown on the Home tab. Typically only for supervisors and admin.
- **Can complete to-dos** — allows the user to mark a to-do item as done (removes it from the list) *without* actually completing the underlying document. A "Complete" button will appear on each to-do item only when this permission is on. If a customer reports the "Complete" button is missing on the to-do list, this permission is off for that role.
- 🎫 If tasks are appearing on the wrong person's to-do list, do not immediately assume a permission issue — see the Supervisor/Supervisee section below.

### Report Permissions
- Each report is individually toggleable within the role.
- Users will only see reports that their role has enabled.
- 🎫 "A report is missing from my report list" = check report permissions on the user's role.

### Occupancy Room Access
- Allows filtering of which rooms and beds a user can see in the Occupancy tab.
- Useful for multi-house inpatient organizations where staff only work in specific housing units.
- Configured within the role; the rooms/beds themselves are created in **Settings > Rooms and Beds**.

---

## Supervisor/Supervisee Settings

- Configured on the **Providers tab** (not in Settings > Roles & Permissions).
- To assign a supervisor: open the provider record, locate the supervisor dropdown, and select the supervising provider.
- **Behavioral impact of a supervisor assignment:**
  - When a supervisee saves a document in **pending status**, it automatically routes to the supervisor's to-do list.
  - The document **disappears from the supervisee's to-do list** once moved to pending — it will only appear on the supervisor's list.
  - If the document is in **draft status**, it stays on the supervisee's list; it only routes to the supervisor when moved to pending.
  - Completed documents do not route to anyone's to-do list.
- Supervisors are also used for **billing** — many customers require a supervisor to be listed on encounters, and this is where that relationship is defined.
- 🎫 **"Tasks showing on wrong person's list"** — the most common cause is incorrect or missing supervisor assignments on the Providers tab. Check and correct these before investigating role permissions.
- ⚠️ There is no automated notification to the supervisor outside of the to-do list item appearing. If the supervisor misses it, there is no escalation mechanism.
- Note: Only documents routed from a supervisee's portal-sent documents are an exception — if a patient returns a document in **pending status** via the patient portal, it routes to whoever sent the document's supervisor, not back to the intake person (even if intake initiated the send).

---

## Caseload Permissions

- Caseload determines which patients a user can see when **"can see all patients"** is off.
- Patients can be assigned to a user's caseload in two ways:
  1. **Patient demographics** — directly on the patient record, in the Assigned Personnel section
  2. **Caseload tab** (left nav) — a global hierarchy view; click "Assign user to caseload," select a case role, user, and patient
- Both methods produce the same result. Either can be used.
- "Show my patients only" filter (available on the Patients tab, Documents tab, and others) filters to show only patients in the user's caseload. **Any assigned personnel role counts** — it does not need to be "primary provider." If a user is assigned as case manager, billing contact, or any other role, the patient will still appear when this filter is on.
- **Caseload roles** (e.g., Case Manager, Primary Provider, Therapist) are customizable. New roles can be added in **Settings > Case Roles**.
- 🎫 If a user reports "Show my patients only" is not working or showing the wrong patients, verify their caseload assignments in the Caseload tab or patient demographics.
- ⚠️ Providers are a subset of Users. Not all users need to be providers. Patients are entirely separate entities from users — they are not created through the Users settings. The only point of connection between providers and patients is the caseload assignment.

---

## User Management

- Accessed via **Settings > Users**. Available to admins and any user with the Users configuration permission turned on.
- Customers have full control over their user list.
- **User states:**
  - **Enabled** — active, can log in
  - **Disabled** — cannot log in; used for temporary leave or contract workers who will return
  - **Deleted** — permanently removed from the system
- Actions available via the three-dot menu on each user: Enable, Disable, Delete, Assign Password, Edit User.
- **Creating a new user:** fill in name, assign role, enter email. Recommend enabling **two-step authentication**.
  - Location access can be assigned at the user level during creation, or separately through the location's User Access settings tab.
  - 🎫 After saving, the new user receives an email with a login link. **This link expires within 24 hours.** If they miss it, they should use the **Forgot Password** link on the login page — do not have the admin re-create the user. Admins can also manually assign a password from the three-dot menu if needed.
- **Editing a user:** clicking Edit User opens the same form used to create the user; all fields are editable.
- ⚠️ Roles are assigned per user, not per location. A user has one role across all locations they have access to. There is no way to give a user different permissions in different locations within the same tenant.

---

## Common Issues in Support Tickets

### "I can't see a tab / feature is missing"
- Almost always a role permission issue. Check what role the user is assigned and what permissions that role grants under General Access.
- **Second check:** verify the user is not in the All Locations view. In All Locations, only Patients, Documents, Schedule, Groups, and Billing tabs are available.
- If the user is in a specific location and has the correct role, escalate to engineering to verify no backend configuration issue.

### "User can't see certain patients"
- Check the **"can see all patients"** permission on their role.
- Verify the user is looking at the correct location (not All Locations view).
- If "can see all patients" is intentionally off, verify the patient is actually assigned to that user's caseload (check Assigned Personnel on the patient record and the Caseload tab).

### "User can access things they shouldn't"
- Review the role assigned to the user and adjust permissions as needed.
- Note: some granular actions (e.g., marking a patient inactive/active) are accessible to **any user with patient chart access**, regardless of role. These are not currently permission-controlled. This is a known system behavior, not a misconfiguration.

### "Tasks are showing on the wrong person's to-do list"
- The most likely cause is incorrect supervisor assignments on the Providers tab.
- The only tasks that should auto-populate on a to-do list are:
  1. Documents the user started (draft or pending status)
  2. Documents attached to appointments where the user is the primary provider (not yet created)
  3. Supervisee documents saved to pending status (routes to the supervisor defined on the Providers tab)
- If tasks are appearing outside of these three scenarios, check supervisor assignments first.

### "User can't complete their document / 'Complete' button is missing"
- Check the user's document permissions for that document type. They may only have Create and Edit access, not Complete and Unlock.
- Alternatively, if the "Can complete to-dos" permission is off, the complete button on the to-do list will be absent — this is expected behavior.

### "New user never received their setup email"
- The email expires within 24 hours. Direct them to use Forgot Password on the login page, or have an admin assign a password manually via the three-dot menu on the user record.

### "A user's services list is limited when scheduling"
- Check the **provider's settings** on the Providers tab. The services listed there dictate what appears in the service dropdown when scheduling. Services not listed for that provider will not appear. This is not a role permission issue.

---

## Additional Notes

- 🔧 **Tenant-level configuration:** Each customer URL (tenant) is separate. Roles, users, and permissions are all tenant-specific. There is no cross-tenant sharing of roles or settings.
- 🔧 **Patient chart in one location at a time:** Patients belong to one location. Permissions are evaluated within the context of the location the user is browsed into. If a customer needs a patient to be seen across locations, the options are: (1) use the Move Patient feature, (2) discharge and create a new episode of care at the new location, or (3) use a single location with Places of Service to differentiate care sites. A true multi-location patient chart (one chart in multiple locations simultaneously) is not currently supported and would require a full system architecture change.
- **Billing tab is universal:** It is available across all locations and is not location-scoped. If a customer wants fully separate billing by location, they would need separate tenants.
```