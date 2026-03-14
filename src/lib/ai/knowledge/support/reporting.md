# Reporting

## Overview

Opus EHR provides various reports for clinical, operational, and financial data. Understanding what reports are available helps the support team answer questions about data access and can sometimes provide creative solutions when a feature isn't available.

Reporting in Opus is delivered through two mechanisms:
1. **Tab-level exports** — almost every left-side navigation tab has an **Export** button that generates a report specific to that tab's data set.
2. **Report Requests panel** — a centralized hub accessible from the **top-right corner** of the interface (not a left-side nav tab) where all requested reports are stored and can be downloaded.

All reports are generated in **CSV/Excel format** and are not configurable to other formats.

---

## Accessing Reports

### Report Requests Panel (Top-Right Icon)

- Located in the **top navigation bar**, alongside messaging, notifications, logs, settings, and help.
- 🎫 Users often miss this because it is not in the left-side navigation. If a user asks "where do I find my reports," direct them to the top-right icon labeled **Report Requests**.
- Clicking **All Reports** shows a list of all previously requested reports, including reports from prior dates.
- To generate a new report: click **Request Report** → select the data set from the left-hand list → apply filters → click **Request**.
- ⚠️ **Reports are asynchronous.** Depending on data volume, a report can take several minutes to generate. The user does **not** need to wait on screen — they can navigate away and return later. The completed report will be available for download in the Report Requests panel.
- Reports are downloaded as **Excel/CSV files**.

### Tab-Level Export Buttons

- Nearly every major tab in Opus (Patients, Documents, Schedule, Billing, etc.) has an **Export** button.
- Clicking Export from a specific tab generates a report scoped to that tab's data.
  - Export from **Patients tab** → patient list/demographic report.
  - Export from **Documents tab** → documentation report.
  - Export from **Billing tab** → encounter/billing data.
- The exported data respects any filters currently active on that tab.
- Exported reports flow to the **Report Requests panel** for download — same destination as manually requested reports.

---

## Available Report Types

- **Clinical Reports**: Patient census, caseload reports, documentation completion status.
- **Scheduling Reports**: Appointment utilization, provider schedules, no-show rates.
- **Billing/Financial Reports**: Revenue reports, claims status, aging reports.
- **Operational Reports**: Staff productivity, compliance metrics.

### Default Reports (No Additional Charge)

- A set of **default reports** is automatically available to all tenants under the Report Requests panel.
- Example: **Patients report** — filterable by status, level of care, and location. Filters can be stacked (e.g., filter by location AND level of care simultaneously).
- Each report's available filter options vary depending on the underlying data set (patients, documents, billing, etc.).

### Custom Reports (Additional Charge)

- 🔧 Customers can request **custom reports** built by the engineering/implementation team, at an additional charge.
- 🎫 If a customer asks for a report that doesn't exist in the default set, confirm whether a custom report would meet their need and escalate to the implementation/engineering team for scoping and pricing.
- ⚠️ A self-service **custom reporting feature** is planned (Janelle referenced Q2 as an approximate target during training — do not quote this date to customers as it may have shifted). Until that feature is live, all non-default reports require engineering involvement.

---

## Report Filters

- Filters are available on both the default report request flow and on tab-level exports.
- Filters are **stackable** — multiple filters can be applied simultaneously.
- Example patient report filters: status, level of care, location.
- Billing tab filter options: service type, patient name, date range — can be stacked.
- ⚠️ The **All Locations view** limits what data is visible. When a user is in All Locations, they see only a subset of tabs (Patients, Documents, Schedule, Groups, Billing). Reports run from this view will reflect all-location data rather than a single location.

---

## Billing Tab as a Reporting Tool

- For customers **without RCM**, the Billing tab functions as the final data endpoint for billing data. They can export encounter data from the Billing tab to pass to a third-party billing system.
- For customers **with RCM**, the Billing tab is the handoff point between the EHR and the RCM — encounters are reviewed here before being synced.
- The Billing tab has robust filter and search capabilities useful for billing-related reporting:
  - Filter by service type, patient, date range, sync status.
  - Search by patient name in the search bar.
  - Filter by encounter status (Action Required, On Hold, Billing Ready, Not Billable).
- ⚠️ The Billing tab displays a maximum of **50 encounters per page**. Bulk syncing via the select-all checkbox only selects the 50 on the current page. Users who need to act on more than 50 at once must paginate.
- ⚠️ Encounters **cannot be merged or split** from the Billing tab. This is a known limitation customers request — there is no merging/splitting feature.
- ⚠️ Encounters can **only be created** by scheduling an appointment, group session, or level of care from the Schedule tab. There is no way to create a standalone encounter from the Billing tab.

---

## System Logs (Audit Trail)

- **Logs** are accessible via the **top navigation bar** (same row as Report Requests, notifications, etc.).
- Two sub-tabs:
  - **Auth**: logs all login activity.
  - **History**: logs all actions taken in the system (patient updates, occupancy changes, document completions, etc.).
- Filters: by user, date/time range, location.
- Search bar: supports keyword search within log details (e.g., searching "bed assigned" to find bed assignment events).
- Default view shows the **last month** of activity.
- ⚠️ Logs are **getting a revamp** — additional logs for documentation detail updates and billing history are planned but not yet live as of training date. Do not promise these to customers.
- 🔧 If a customer needs logs that are not visible in the front-end, it is unclear whether engineering can provide back-end log exports. This has been flagged internally as a gap requiring clarification with the engineering team. Escalate to engineering if a customer requires logs beyond what is visible in the UI.

---

## Common Support Scenarios

### "Do you have a report for X?"

- Check if an existing **default report** covers the data the customer needs.
- Check whether the relevant tab has an **Export button** that would produce the needed data.
- If not, consider whether a **custom report** could be built to address their need (additional charge, requires engineering).
- If the customer is asking about a future capability, note that enhanced self-service reporting is on the roadmap but avoid committing to a date.

### "The report shows wrong data"

- Verify the **date range and filters** being used.
- Check if the user is in the **All Locations view vs. a specific location** — this affects the scope of data returned.
- Check if the **data source** (appointments, encounters, documents, etc.) is up to date.
- Consider whether there's a **data sync lag** affecting the report.
- If the report was just requested, confirm the user has **waited for async generation** to complete — they should check the Report Requests panel after a few minutes rather than expecting instant results.

### "Where do I find my reports / I can't find the report I ran"

- Direct the user to the **Report Requests icon in the top-right navigation bar** (not the left-side tabs).
- All previously requested reports are stored there under **All Reports**, including reports generated in prior sessions.

### "Can I export data out of Opus?"

- Yes — via the **Export buttons** on individual tabs, or via the **Request Report** flow.
- All exports are in **CSV/Excel format only**.
- 🎫 If a customer asks for PDF or other format exports, this is not currently supported. Log as a feature request if applicable.

### Creative Problem-Solving with Reports

- Sometimes a customer asks for a feature that doesn't exist, but the same goal can be achieved through a report or existing filter functionality.

- **"I need to see all patients who haven't been seen in 30 days"** — address with a scheduling/caseload report filtered by last appointment date, or suggest filtering the Patients tab by status and exporting.

- **"I need to track which patients are in a specific program"** — Badges can tag patients by program/category, and the Patients tab can be filtered by badge. Exporting that filtered view gives a program-specific patient list. This is a common creative workaround.

- **"I need to know which providers are behind on documentation"** — The Documents tab export, filtered by documentation status (draft/pending/not created), can serve as a documentation completion report. The To Do list also surfaces outstanding documentation per user, and an admin with the "can see all to dos" permission can view other users' task lists.

- **"I need to see all encounters with a specific authorization number or service"** — The Billing tab supports filtering and searching by service type and patient; stacked filters can narrow results significantly.

- **"I need an audit trail of what a specific user did"** — Direct them to Logs > History, filtered by that user and date range. Remind them of current log limitations and the planned revamp.

- When suggesting a report as a solution, explain what it will show and how it addresses their specific need.

---

## Known Limitations & Escalation Paths

- ⚠️ **No real-time / live reports** — all reports are generated asynchronously and downloaded as static files.
- ⚠️ **No in-app report viewer** — reports must be downloaded to view. There is no way to view report data inside Opus.
- ⚠️ **Custom reports cost extra** — do not promise free custom reports to customers.
- ⚠️ **Self-service custom reporting not yet available** — planned for a future release. Escalate custom report requests to implementation/engineering.
- ⚠️ **Billing tab pagination limit** — only 50 encounters shown per page; select-all only covers the current page.
- 🔧 All **places of service** are configured by the engineering team; customers cannot add or modify these themselves through settings.
- 🔧 Any report capabilities that require new data points not currently surfaced in the default set must go through the engineering team.
- 🎫 If a customer reports that their report is taking an unusually long time (e.g., many hours) and still shows no download available, escalate to engineering to check for a failed report generation job.