Opus Support Authority Matrix Policy Guide v1
Purpose
This document explains how Tier 1 Support should use the Opus Support Authority Matrix. It is intended to create consistency, reduce risk, protect customer data and workflow integrity, and clarify when Tier 1 may act directly versus when approval or escalation is required.
This guide should be used together with the live Authority Matrix spreadsheet, which serves as the operational source of truth.

Core Support Principle
Opus remains the customer-facing owner of support across the Opus ecosystem, including third-party, vendor-supported, and white-labeled systems.
Customers should work with Opus Support, not with vendors directly, for standard support matters.
Even when a vendor, engineering team, or internal specialist is needed to resolve an issue, Opus Support remains responsible for:
triage
coordination
follow-up
status updates
customer communication

Default Support Philosophy
Tier 1 Support is expected to be helpful, educational, responsive, and proactive.
The default posture should be:
teach first
guide first
encourage customer self-service where appropriate
avoid making risky changes without approval
escalate when the issue falls outside Tier 1 authority
Tier 1 Support should not casually take actions that may create:
security risk
compliance risk
PHI exposure
access control risk
workflow disruption
configuration errors
customer conflict
vendor-side unintended consequences

How to Use the Authority Matrix
For every request, Tier 1 should determine:
What is the customer asking for?
Is this a how-to issue, access issue, configuration issue, bug, change request, or training request?
Can Tier 1 do this directly?
Does this require written customer approval?
Does this require internal approval?
Must this be escalated?
Who is the correct escalation owner?
What should be communicated back to the customer right now?
The matrix should be used as the operational decision tool for answering those questions.

Definitions
Tier 1 Can Do Directly
Tier 1 may complete the action without needing customer approval or internal approval, as long as the action is within normal support boundaries and there are no unusual risks.
Examples:
answering how-to questions
providing educational guidance
performing basic troubleshooting
providing routine status updates
contacting vendors for case progression
Tier 1 Can Do With Written Customer Approval
Tier 1 may complete the action only if written approval has been received from the authorized account POC or admin on file.
Examples:
disabling a user
modifying user permissions or roles
making simple template or form changes
deleting forms or templates when appropriate approval exists
Tier 1 Can Do With Internal Approval
Tier 1 may complete or communicate the action only after approval from the proper internal owner or manager.
Examples:
recommending a non-standard workaround
executing certain edge-case actions during emergency/security situations
Tier 1 Cannot Do / Must Escalate
Tier 1 may not perform the action and must instead route it to the correct internal owner, customer authority, or scoped work process.
Examples:
creating a new user
granting new access
changing billing configurations
updating provider credentials
changing ePrescribe settings
making report changes
handling mass data export as routine support
performing advanced training as standard support

Written Approval Standard
When written approval is required, the approval must come from the authorized account POC or admin on file.
Tier 1 should not rely on:
verbal approval
implied approval
approval from a regular end user
approval from someone whose authority is unclear
informal assumptions about who “usually handles this”
If the requester is not clearly authorized, Tier 1 should pause the action and seek confirmation from the proper account contact.

Teach First, Do Second
Whenever practical, Tier 1 should first encourage the customer to complete administrative actions themselves and should provide guidance on how to do so.
This helps:
preserve customer ownership of their own environment
reduce unnecessary support-side risk
build customer capability
avoid support becoming the operator of the customer’s internal system decisions
This does not mean refusing to help. It means helping in the right way.
Examples of the right posture:
explain how to update roles or permissions
show the customer where to make the change
explain what a setting does
clarify what approval is needed
walk the customer through the steps

Access and Security Guardrails
Tier 1 Support may not create new users or grant new access based on an end-user request.
This is a strict protection against:
phishing attempts
impersonation
unauthorized access
poor access control hygiene
Tier 1 may disable users or modify roles only when the proper written approval exists or when a documented internal emergency/security path applies.
If there is uncertainty, Tier 1 should escalate rather than guess.

Vendor and Connected-System Support
Opus Support is the go-between for vendor-related issues.
Tier 1 may and should contact vendors directly when needed for case progression, follow-up, investigation, or updates.
Customers should not be told to manage vendor relationships themselves for standard support matters.
Tier 1 should:
open or follow vendor cases
chase updates actively
document progress
keep the customer informed
continue to own the case on the Opus side
Support should never become passive while waiting on a vendor.

Urgency and Escalation Philosophy
Not every serious issue is an emergency.
Tier 1 should distinguish between:
Emergency / Urgent Issues
These require immediate attention and may require Slack plus Linear escalation.
Examples:
multiple tenants cannot log in
claims cannot be transmitted
EHR to RCM integration is materially broken
prescribing workflow is critically blocked
a major access failure is impacting core business operations
a key account is materially blocked from a mission-critical workflow
High-Priority but Not Emergency Issues
These are important, but do not necessarily require after-hours or immediate engineering intervention.
Examples:
billing rules are behaving incorrectly but staff can still manually work the claims
queue logic is causing rework
workflow defects exist but do not fully stop operations
a configuration issue is causing friction rather than complete operational stoppage
The operating principle is simple:
If the issue materially blocks revenue transmission, prescribing, or core multi-user workflow, treat it as urgent.
If the issue causes manual work, inefficiency, or pain but operations continue, treat it as important but not emergency-level.

Slack vs Linear Escalation
Use Linear
Use Linear when engineering review, investigation, or implementation work is needed.
Use Slack Plus Linear
Use Slack plus Linear when the issue is urgent or critical, such as:
broad outage
multi-tenant access failure
claims transmission failure
prescribing-blocking issue
materially blocked key account
live issue requiring immediate engineering visibility
The presence of a Linear ticket does not by itself make the issue urgent. The urgency is determined by business impact.

Customer Communication Standard
Tier 1 Support must act as a customer advocate.
If a ticket remains open and is pending internal or vendor action, the default expectation is that the customer receives proactive daily updates, unless a different expectation has been explicitly set.
Even when there is no major progress, Tier 1 should communicate.
A simple update is still better than silence.
Example:
“Hi, I wanted to give you a quick update that your ticket is still actively being worked on. We are currently waiting on follow-up from the appropriate internal team and will continue to push this forward. I’ll keep you updated.”
If meaningful progress is stalled, the matter should be internally escalated by the Customer Support Manager.

Workarounds
Tier 1 may help customers solve problems creatively, but non-standard workarounds should not be recommended externally without internal approval.
Why:
workarounds may have side effects
workarounds may create downstream issues
workarounds may unintentionally conflict with best practices or system design
If a workaround has already been formally reviewed and documented, Tier 1 may use it.
If a workaround is new, unusual, or uncertain, it should be reviewed by the Customer Support Manager first.
If a workaround is used, customers should be informed of any known or possible limitations or side effects.

Standard Support vs Scoped Work
Some requests should remain standard support. Others should automatically move into a scoped, approved, and in some cases paid work process.
Standard Support Examples
how-to questions
routine troubleshooting
quick educational guidance
basic login assistance
classification of bugs versus configuration issues
simple approved administrative actions within Tier 1 authority
Scoped Work / SOW Examples
report changes
complex form builds
large batches of form work
mass data exports
advanced billing training
larger custom efforts requiring defined scope, timeline, and approval
When the request exceeds normal support boundaries, Tier 1 should not casually treat it as ordinary ticket work. It should be routed into the appropriate scoped work process.

Simple Rules Tier 1 Should Remember
1. If it touches access creation, do not do it.
Creating users or granting new access is not a Tier 1 action.
2. If it requires customer authority, get it in writing.
Do not rely on assumptions or casual approvals.
3. If the customer can reasonably do it themselves, teach first.
Support should guide and empower whenever appropriate.
4. If it is risky, structural, vendor-side, or engineering-dependent, escalate it.
Do not improvise with high-risk actions.
5. If the issue is still open, keep the customer updated.
Silence is not acceptable.
6. If the issue is blocking claims, prescribing, or broad access, escalate urgently.
Use the urgent path when business-critical workflows are materially blocked.
7. If it looks like real project work, treat it like scoped work.
Do not let support absorb undefined implementation work.

Practical Examples
Example 1: End User Requests a New Account
Tier 1 should not create the account.
Tier 1 should identify the authorized customer admin or POC and direct the requester appropriately.
Example 2: Authorized Admin Emails to Disable a Former Employee
Tier 1 may process the disablement if the request is in writing and the sender is the authorized admin on file.
Example 3: End User Wants Their Role Changed
Tier 1 should first encourage the customer admin to handle it directly.
If written approval from the authorized POC/admin is provided, Tier 1 may execute the change.
Example 4: Customer Cannot Access RCM Due to SSO Failure
Tier 1 should perform basic troubleshooting first.
If unresolved, Tier 1 should escalate to engineering.
If the issue is materially blocking billing operations, it should be treated urgently.
Example 5: Customer Wants a New Report
Tier 1 should gather requirements, clarify the request, and route it into the SOW / scoped work process.
Tier 1 should not position this as a routine support task.
Example 6: Customer Wants 17 New Forms Built
This is scoped work, not standard support.
Tier 1 should route it accordingly.
Example 7: Vendor Is Slow to Respond
Tier 1 should continue following up, maintain customer communication, and escalate internally if progress stalls.

Final Operating Statement
Support exists to help, educate, triage, coordinate, and advocate for the customer.
Support does not exist to make risky changes casually, bypass customer authority, blur access controls, or allow vendor dependency to create a poor customer experience.
When in doubt, Tier 1 should:
verify authority
assess risk
follow the matrix
escalate appropriately
keep the customer informed


