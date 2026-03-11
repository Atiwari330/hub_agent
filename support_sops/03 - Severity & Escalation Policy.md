Opus Support Severity and Escalation Policy v1
Purpose
This policy defines how Opus Support should classify issue severity, when and how issues should be escalated, what distinguishes urgent issues from standard issues, and what communication expectations apply during active issue resolution.
The purpose of this policy is to:
create consistency in how support issues are classified
ensure truly urgent issues receive immediate attention
prevent overuse of emergency escalation channels
protect critical customer workflows
create clarity around when Support should involve management, engineering, or vendors
ensure customers are kept appropriately informed throughout the lifecycle of an issue
This policy should be used together with the Opus Support Authority Matrix and the Customer Authorization and Approval Policy.

Core Policy Principle
Not every important issue is an emergency.
Opus Support should classify and escalate issues based on business impact, not just customer frustration or the presence of a defect.
The most important question is:
What is the actual operational impact of this issue right now?
Severity should be based on how materially the issue affects:
access to the system
ability to prescribe
ability to transmit claims
ability to carry out core operational workflows
scope of impact across users, teams, accounts, or tenants

Severity Philosophy
Support should think about severity using the following lens:
Critical / Urgent
The issue is materially blocking a mission-critical workflow and requires immediate visibility and action.
High Priority but Not Emergency
The issue is serious and important, but the customer can still continue operations through manual work, partial functionality, or a temporary workaround.
Standard
The issue should be addressed in the normal support flow and does not require emergency handling.
The goal is to reserve urgent escalation for issues that genuinely justify it.

Severity Levels
Severity 1 – Critical / Urgent
Definition
A Severity 1 issue is a live issue that materially blocks a core workflow and requires immediate internal attention.
These are the kinds of issues that may justify urgent engineering visibility, Slack escalation, and fast management attention.
Common Characteristics
multiple users or multiple tenants are affected
a mission-critical function is unavailable
no reasonable workaround exists
the issue is actively blocking core business operations
delay materially worsens operational, revenue, or patient-care impact
Examples
multiple tenants cannot log in
a broad login or access failure affects core system usage
claims cannot be transmitted
the EHR to RCM integration is materially broken
a prescribing workflow is critically blocked
a key account is materially blocked from a mission-critical workflow
a major outage or degradation is preventing normal operations
Standard Escalation Path
immediate internal review by Support
urgent engineering escalation
Slack plus Linear escalation
Customer Support Manager awareness
vendor engagement if vendor dependency is involved
active customer communication

Severity 2 – High Priority but Not Emergency
Definition
A Severity 2 issue is important and time-sensitive, but does not justify true emergency handling because operations can still continue in some way.
These issues may still require engineering review or vendor coordination, but they do not automatically justify after-hours or live-incident treatment.
Common Characteristics
workflow is impaired but not fully blocked
customer is experiencing significant inefficiency or rework
a workaround or manual process exists
the issue is operationally painful but not system-down
the issue is important to fix quickly, but not a “stop everything” event
Examples
billing rules are not behaving correctly, but staff can still manually work claims
queue logic is causing significant rework
a defect is disrupting workflow but not fully stopping it
a connected workflow is unreliable but still partially usable
a single-account issue is serious but not causing full operational stoppage
Standard Escalation Path
standard engineering ticket if needed
manager visibility when appropriate
vendor follow-up when needed
customer updates at least daily while the issue is active and unresolved

Severity 3 – Standard
Definition
A Severity 3 issue is a normal support issue that should be worked through the standard support process.
Common Characteristics
issue is isolated
issue does not materially block a core workflow
issue may be informational, procedural, or low operational impact
no emergency escalation is justified
Examples
how-to questions
isolated user confusion
non-urgent access troubleshooting
minor defects with low business impact
routine ticket follow-up
standard vendor coordination on non-urgent issues
small approved administrative actions
informational or training-oriented requests
Standard Escalation Path
normal support handling
escalate only if investigation reveals broader impact, unusual risk, or engineering dependency

Simple Severity Rule for Reps
Tier 1 should use this rule of thumb:
Treat as Severity 1 if:
the issue materially blocks:
claims transmission
prescribing
broad login/access
multi-user or multi-tenant core workflow
a mission-critical workflow for a key account
Treat as Severity 2 if:
the issue is serious and painful, but:
manual work can continue
a workaround exists
operations are impaired, not stopped
Treat as Severity 3 if:
the issue is:
routine
isolated
informational
low operational impact
not time-critical

Escalation Channels
Linear
Linear should be used when an issue requires engineering investigation, engineering remediation, or engineering implementation work.
Linear is the standard formal path for engineering-track issues.
Use Linear when:
the issue requires code review or engineering investigation
the issue may involve integration logic
the issue may involve backend configuration or technical remediation
a system behavior appears broken beyond standard support handling
the issue needs formal engineering tracking

Slack Plus Linear
Slack plus Linear should be used when the issue requires immediate internal visibility due to urgency or broad business impact.
Use Slack plus Linear when:
the issue is Severity 1
multiple tenants are affected
claims transmission is broken
prescribing is materially blocked
broad login/access failure is occurring
a key account is materially blocked in a core workflow
engineering attention is needed urgently, not just eventually
Slack is not a substitute for Linear.
If engineering work is needed, Linear should still exist.

Management Escalation
The Customer Support Manager should be brought in when:
a Severity 1 issue exists
a Severity 2 issue is stalled
customer communication is becoming sensitive
vendor follow-up is not progressing
the rep is unsure whether the issue should be reclassified
the issue may create customer dissatisfaction or escalation risk
there is internal ambiguity around ownership or next steps
progress is not happening at a reasonable pace
The manager’s role is not only to observe. The manager is expected to help move the issue forward internally.

Vendor Escalation
When a vendor-dependent issue exists, Support should maintain ownership of the case and engage the vendor directly.
Vendor dependency does not reduce Opus’s responsibility to communicate clearly with the customer.
Vendor escalation should occur when:
initial internal troubleshooting suggests vendor dependency
vendor action is required for investigation or remediation
the issue involves a known vendor-connected workflow
vendor-side access, settings, or service behavior appears implicated
If the vendor is slow or unresponsive, Support should continue pushing and should escalate internally through management as needed.
Support should never become passive while “waiting on the vendor.”

Reclassification of Severity
Severity is not static.
An issue may need to be reclassified up or down as new facts emerge.
Examples:
a Severity 3 issue may become Severity 2 if the impact is broader than first understood
a Severity 2 issue may become Severity 1 if a workaround fails and operations become blocked
a Severity 1 issue may be downgraded once the core operational impact is contained
Tier 1 should not be afraid to re-evaluate severity as the situation becomes clearer.

Customer Communication Expectations
Support must communicate proactively during open issue resolution.
Default Rule
If a ticket is still open and pending internal or vendor action, the customer should receive proactive updates at least daily, unless a different expectation has been explicitly set.
Even if there is no major progress, Support should still communicate.
Silence creates uncertainty and damages trust.
Good Update Example
“Hi, I wanted to give you a quick update that your issue is still actively being worked on. We are currently waiting on follow-up from the appropriate internal team and will continue pushing this forward. I’ll keep you updated.”
Communication Principles
acknowledge impact
confirm ownership
explain next step when possible
avoid overpromising
do not disappear
continue updates until the issue is resolved or a different update cadence has been clearly agreed

Internal Documentation Standard
Every escalated issue should be documented clearly enough that another team member can understand:
what is happening
who is affected
current severity
what has been tried
what workaround exists, if any
who currently owns the next step
whether engineering is involved
whether a vendor is involved
what the customer has been told
when the next update is due
Good escalation without documentation is not real escalation.

Examples of Correct Severity Classification
Example 1: Multiple Tenants Cannot Log In
Severity 1
This is a broad access failure affecting core operations.
Example 2: Claims Are Not Being Transmitted
Severity 1
This materially blocks revenue-cycle workflow.
Example 3: Billing Rules Are Incorrect and Staff Must Work Claims Manually
Severity 2
This is urgent and important, but operations can still continue.
Example 4: Prescribing Workflow Is Blocked for an Active Customer
Severity 1
This is operationally and clinically sensitive and should be treated urgently.
Example 5: One User Has Trouble Logging In but Basic Troubleshooting Has Not Yet Been Completed
Start as Severity 3 or Severity 2 depending on context
If the issue appears isolated, begin in the normal flow and reassess if broader impact is discovered.
Example 6: A Defect Causes Operational Friction but a Workaround Exists
Severity 2
Important, but not emergency-level.
Example 7: Customer Requests a New Report and Says It Is “Urgent”
Not a Severity 1 issue
This may be an important business request, but it is not an operational incident.

Behaviors to Avoid
Support should avoid:
treating every unhappy customer as an emergency
under-classifying truly urgent issues
using Slack for routine engineering requests
waiting too long to escalate a real blocker
assuming vendor dependency removes Opus ownership
going silent while waiting on internal or vendor teams
escalating without documenting the issue properly
confusing urgency with inconvenience

Practical Escalation Rules for Tier 1
Escalate urgently when:
claims cannot be transmitted
prescribing is blocked
broad access/login is broken
multiple tenants are affected
a key account is materially blocked from a core workflow
no reasonable workaround exists for a critical issue
Escalate normally when:
engineering input is needed but the issue is not live-critical
workflow is impaired but not stopped
a vendor issue needs follow-up
a bug exists but does not materially block operations
Involve the Customer Support Manager when:
the issue is sensitive
progress has stalled
ownership is unclear
vendor progress is poor
customer frustration is rising
the rep is unsure how to classify or escalate the issue

Final Operating Statement
Severity should reflect real business impact, not emotion alone.
Support should escalate quickly when mission-critical workflows are materially blocked, but should avoid turning every serious issue into an emergency.
The goal is to be:
calm
consistent
responsive
operationally sound
highly communicative
disciplined in escalation
When in doubt, Tier 1 should assess impact, document clearly, escalate appropriately, and keep the customer informed.

