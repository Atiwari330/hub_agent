# Eligibility Verification

## Overview

Eligibility verification in Opus RCM / Imagine uses the 270/271 EDI transaction standard to check patient insurance eligibility with payers. This is a common source of support tickets and has its own dedicated workflow.

---

## Batch Eligibility (270/271)

### 270 Transaction
- The eligibility inquiry sent to the payer.

### 271 Transaction
- The eligibility response received from the payer.

---

## Scheduled Jobs for Eligibility

### Generate Job
- Scheduled job that generates eligibility inquiries.

### Fetch Job
- Scheduled job that retrieves eligibility responses.

---

## Eligibility Settings

- Configuration options for eligibility verification.

---

## Excluding Payers

- How to exclude specific payers from batch eligibility checks.

---

## Common Issues in Support Tickets

### "Eligibility isn't showing for a patient"
- Verify scheduled jobs are running (both generate and fetch).
- Check if the payer is excluded from eligibility checks.
- Verify patient insurance information is correct and complete.

### "Eligibility shows inactive but patient says they have coverage"
- The 271 response reflects what the payer reports. Recommend the patient contact their insurance to verify.
- Check that the correct payer/plan is configured on the patient account.
