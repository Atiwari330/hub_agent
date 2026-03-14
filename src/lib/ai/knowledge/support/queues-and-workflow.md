# Queues & Workflow (RCM)

## Overview

The queues in Opus RCM / Imagine are the primary daily workflow for billing staff. Ben (trainer) referred to this as the "meat and potatoes" of the system. Each queue surfaces a specific category of items requiring attention.

---

## Eligibility Error Queue
- Items with eligibility verification errors.

## Pending Eligibility Queue
- Items awaiting eligibility verification results.

## Demographic Import Error Queue
- Items with errors importing demographic data from the EHR.

## Procedure Import Error Queue
- Items with errors importing procedure/service data from the EHR.

## Pre-Submission Error Queue
- Items that failed scrubbing/validation before claim submission.

## Claim Status Queue
- Items tracking the status of submitted claims.

## Outgoing Insurance Claim Queue
- Claims ready to be sent or in the process of being sent to payers.

## Follow-Up Queue
- Items requiring follow-up action (e.g., aged claims, pending responses).

## Credit Balance Queue
- Accounts with credit balances that need to be resolved (refund, apply to other services, etc.).

## Collections Queue
- Accounts that have moved into the collections workflow.

## Unapplied Payments Queue
- Payments received that have not been applied to a specific visit/service.

## Underpaid Procedures Queue
- Procedures where the payment received was less than expected.

## Automatic Payment Error Queue
- Errors that occurred during automatic payment posting.

## Custom Queues
- User-defined queues with custom criteria.

---

## Common Issues in Support Tickets

### "Items stuck in a queue"
- Review the specific error or status for that queue and follow the resolution workflow.

### "Queue is showing items that shouldn't be there"
- Check queue criteria and filters, verify data accuracy.
