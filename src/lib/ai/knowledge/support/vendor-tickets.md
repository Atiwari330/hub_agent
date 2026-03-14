# Vendor-Originated Tickets

## How to Identify Vendor Tickets

Sometimes tickets in the queue are NOT from customers — they are from vendor partners reporting issues back to Opus. You can identify these by:

### Company Name Signals
- **"Imagine Software"** — the current RCM vendor
- **"ImaginePay"** — payment processing arm of Imagine
- **"PracticeSuite"** — the legacy billing vendor
- Any vendor name that is NOT a healthcare facility/practice

### Subject Line Signals
- Contains "IT-Assistant Alert" or automated ticket references
- Contains vendor ticket IDs or internal reference numbers
- Automated system notifications from vendor platforms

### Content Signals
- Messages from vendor reps (e.g., Deanna Rector at ImaginePay) reporting data issues
- Language like "your system sent us bad data" or "your integration is breaking something on our side"
- References to API errors, data sync issues, or integration failures originating from Opus EHR

## What Vendor Tickets Mean

These are back-channel communications where the vendor is saying:
- "Hey Opus, your system sent us bad data"
- "Your integration is breaking something on our side"
- "We're seeing errors when processing data from your platform"

## Systemic Risk

Vendor-reported data issues (like impossible balances, broken token generation, sync failures) often affect **MULTIPLE customer accounts**, not just the one mentioned in the ticket. Always flag this systemic risk in the analysis.

## Key Distinction

Vendor tickets require a different workflow than customer tickets:
- The "customer" here is actually a business partner
- The fix typically requires engineering work on the Opus EHR side
- A Linear ticket for the engineering team is critical
- The ticket cannot be closed until the vendor confirms the fix on their end
