# Revenue Cycle Management — Claims Flow

## Overview

Opus EHR is NOT a billing/RCM system itself — it integrates with external billing vendors via API. The billing pipeline flows from clinical operations in Opus EHR to claims processing in the external RCM system.

## The Claims Pipeline

```
Schedule Appointment → Encounter Created → Claim Data Assembled → API Push → Opus RCM (Imagine) → Claim Submitted to Payer
```

### Step 1: Schedule Appointment
- A scheduled appointment in Opus EHR carries the **CPT code** (e.g., 90791 for psychiatric diagnostic evaluation).
- The appointment is linked to a **patient/client** (who has insurance on file) and a **provider** (who has an NPI number).
- The **place of service** is set on the appointment.

### Step 2: Encounter Creation
- When the appointment is completed and documentation is finalized, it becomes an **encounter**.
- The encounter brings together all the billing components:
  - **CPT code** — from the scheduled appointment
  - **Place of service** — from the appointment
  - **Insurance/payer info** — from the patient record
  - **Provider NPI** — from the assigned provider
  - **Diagnosis codes (ICD-10)** — from the clinical documentation

### Step 3: Claim Data Push via API
- Opus EHR sends the encounter data to **Opus RCM / Imagine** via API integration.
- This is an automated process — once the encounter is finalized, the data flows to the billing system.

### Step 4: Claim Processing in Opus RCM (Imagine)
- **Opus RCM** is the current billing vendor (white-labeled version of the Imagine platform, branded as "Opus RCM").
- Imagine handles: claim creation, claim submission to payers, ERA posting, payment processing (via ImaginePay), and token generation.
- **ImaginePay** handles payment processing and token generation for patient payments.

## Vendor Landscape

### Current Vendor: Opus RCM / Imagine / ImaginePay
- This is the CURRENT billing/RCM vendor.
- White-labeled version of the Imagine platform.
- Handles claims, ERA posting, payment processing.
- Data flows from Opus EHR → Imagine via API.

### Legacy Vendor: PracticeSuite
- PracticeSuite is the LEGACY billing vendor.
- Opus NO LONGER onboards new customers to PracticeSuite.
- Actively migrating existing customers OFF of PracticeSuite.
- Issues involving PracticeSuite data exports, migrations, or ERA files are complex and often require CS Manager and Head of Client Success to problem-solve together.

## Common Issues in Support Tickets

### Claims Not Flowing / Sync Failures
- Check if the encounter was properly finalized in Opus EHR.
- Check if the API integration between Opus and Imagine is functioning.
- Verify all required billing components are present (CPT, POS, insurance, NPI, diagnosis).

### Missing Billing Components
- **Missing insurance**: Check the patient record — insurance must be set up before the encounter.
- **Missing NPI**: Check the provider profile.
- **Missing CPT code**: Check the appointment/encounter — the service code must be assigned.
- **Missing place of service**: Must be set on the appointment.

### ERA / Payment Issues
- ERA (Electronic Remittance Advice) posting is handled by Imagine, not Opus EHR.
- Payment processing goes through ImaginePay.
- Token generation issues are on the Imagine/ImaginePay side.

### PracticeSuite Migration Issues
- Data exports and migrations from PracticeSuite are complex.
- ERA file handling differs between PracticeSuite and Imagine.
- These typically require CS Manager + Head of Client Success involvement.

## Key Distinction for Troubleshooting
- If the issue is about **data not appearing in the billing system** → likely an API/integration issue between Opus EHR and Imagine.
- If the issue is about **claims being rejected by payers** → likely a data quality issue (missing/incorrect billing components) or a configuration issue on the Imagine side.
- If the issue involves **PracticeSuite** → this is legacy and complex — escalate appropriately.
