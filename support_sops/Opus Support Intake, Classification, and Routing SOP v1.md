Opus Support Intake, Classification, and Routing SOP v1
Purpose
This SOP defines how Tier 1 Support should intake, classify, triage, and route customer issues consistently from first receipt through next action.
The purpose of this SOP is to:
create a repeatable first-pass triage process for all inbound support matters
ensure Tier 1 classifies issues before acting
operationalize the Opus Authority Matrix, Customer Authorization and Approval Policy, Severity and Escalation Policy, and Vendor Coordination Policy
improve routing quality to Support, Engineering, Onboarding, and vendor-related workflows
reduce improvisation, weak escalations, and unauthorized actions
maintain a high-quality customer experience through clear ownership and proactive communication
Scope
This SOP applies to support matters received through:
email
chat
internal handoff from another Opus team
This SOP applies across the Opus support ecosystem, including but not limited to:
Opus EHR
Clinical Documentation / Forms / Templates
Opus RCM / Imagine
Phicure / Clearinghouse
Imagine Pay / Payments
Opus CRM / LeadSquared
DoseSpot / ePrescribe
Advanced eMAR / EIR Systems
Nabla / Copilot
Access / SSO / Identity
Reporting / Data
Integrations
This SOP should be used together with:
the Opus Support Authority Matrix
the Opus Customer Authorization and Approval Policy
the Opus Support Severity and Escalation Policy
the Opus Vendor Coordination Policy
Core Operating Principles
Tier 1 Support should follow these principles on every ticket:
1. Classify before acting
Tier 1 should first determine what type of issue is being presented before taking material action. The rep should identify product area, issue type, likely impact, and likely next route before progressing the case.
2. Ownership stays with Opus
Customers should experience Opus as the single support front door. Even when a vendor is involved, Opus owns case management, follow-up, and customer communication. Customers should not be told to manage standard vendor support matters themselves.
3. Severity is based on operational impact
Severity should be based on actual business and workflow impact, not just customer frustration or the presence of a defect. Not every serious issue is an emergency.
4. Authorization is required before impactful action
If a request affects access, permissions, configuration, templates, reports, exports, vendor-side settings, billing settings, or other material aspects of the customer environment, Tier 1 should assume authorization is required unless the Authority Matrix clearly states otherwise.
5. Teach first, do second
Whenever practical, Tier 1 should guide the customer to complete administrative actions themselves rather than unnecessarily taking over administrative control. Support should be helpful and educational without becoming the operator of the customer’s internal environment.
6. Scoped work is not routine ticket work
Requests involving redesign, custom deliverables, advanced changes, large-volume work, or project-like implementation should not be handled as ordinary ticket work simply because a customer asked for them. These should be clarified, documented, and routed into the SOW / scoped-work process.
7. Do not become passive
Opening a vendor case, sending a Linear ticket, or asking another team for help does not end Tier 1 ownership. Tier 1 remains responsible for case progression, documentation, and customer updates until the issue is resolved or clearly handed off through an approved path.

Section 1. Required First-Pass Triage Checklist
When a ticket arrives, Tier 1 should complete the following first-pass triage steps before taking material action:
identify the customer account
identify the requester
identify the affected user, workflow, or area if known
identify or estimate the product area
identify the issue type
determine whether the issue is a support issue, service request, change request, training request, or scoped-work request
determine whether severity is clear or should be marked Needs Triage temporarily
determine whether customer authorization is required before action
determine whether vendor dependency is likely
determine the next correct route
send an initial customer response that confirms ownership and next step
document the ticket clearly
If information is incomplete, Tier 1 should not guess. The ticket may be classified temporarily as Unknown / Needs Triage, but the rep is still expected to actively move the case toward proper classification.

Section 2. Product Area Classification
Every ticket should be assigned a product-area category, even if the first classification is temporary.
Approved product-area categories:
Opus EHR
Clinical Documentation / Forms / Templates
Opus RCM / Imagine
Phicure / Clearinghouse
Imagine Pay / Payments
Opus CRM / LeadSquared
DoseSpot / ePrescribe
Advanced eMAR / EIR Systems
Nabla / Copilot
Access / SSO / Identity
Reporting / Data
Integrations
Unknown / Needs Triage
Guidance
Tier 1 does not need perfect certainty at first touch, but should choose the best current category based on the information available.
Examples:
login issue affecting one or more systems = Access / SSO / Identity
note template change request = Clinical Documentation / Forms / Templates
claim submission problem = Opus RCM / Imagine or Phicure / Clearinghouse, depending on what is known
payment processor issue = Imagine Pay / Payments
prescribing issue = DoseSpot / ePrescribe
medication administration issue = Advanced eMAR / EIR Systems
AI copilot issue = Nabla / Copilot
report result concern = Reporting / Data
issue crossing multiple connected systems = Integrations

Section 3. Issue Type Classification
Every ticket should also be assigned an issue-type category.
Approved issue-type categories:
1. Support Issue
An existing function appears broken, unavailable, failing, or not behaving as expected in the current environment.
Examples:
login failure
portal unavailable
claim transmission failure
sync not working
error in expected workflow
2. Service Request
A customer is asking Opus to assist with an allowed operational or administrative action within the existing environment.
Examples:
routine administrative assistance
allowed troubleshooting help
standard account-support activity
3. Change Request
The customer wants something changed from its current state, but the request is discrete and specific.
Examples:
report logic change
template text adjustment
form update
approved provider setup adjustment
4. Training Request
The customer is asking how to perform a task, understand a workflow, or clarify expected behavior. The system is not necessarily malfunctioning.
Examples:
“How do I do this?”
workflow understanding question
repeated confusion about expected behavior
5. Scoped Work / SOW Request
The customer is asking for custom work, redesign, implementation-like work, advanced service work, or other project-style deliverables.
Examples:
workflow redesign
new custom report
full form redesign
new template build
bulk data request
historical export
integration mapping change
billing workflow redesign
advanced training
project-style system work
6. Outage / Degradation
A broader live issue or service-impact issue appears to be affecting a critical workflow, multiple users, multiple accounts, or a materially important system behavior.
7. Unknown / Needs Investigation
Used only when the issue type cannot yet be classified responsibly from the information available.

Section 4. Support vs Request vs Scoped Work Decision Logic
Tier 1 should use the following reasoning model:
If the customer says something is not working
Treat it first as a possible support issue and investigate whether the issue may actually be:
user error
training gap
customer configuration issue
approval issue
internal Opus issue
integration issue
vendor-dependent issue
If the customer is asking for something to be changed
Treat it as a change request unless it clearly rises to scoped work.
If the customer is asking for redesign, large-volume work, custom deliverables, or project-like implementation
Treat it as scoped work / SOW.
If the customer mainly needs explanation or coaching
Treat it as a training request unless there is evidence the system is actually malfunctioning.
Examples
report change = change request, often routed to scoped work depending on scope
form/template edit = change request
bulk data request = scoped work / SOW
workflow redesign = onboarding / implementation / SOW
billing workflow redesign = scoped work / SOW
advanced training request = scoped work / SOW
custom report build = scoped work / SOW

Section 5. Severity Check
After first-pass classification, Tier 1 should determine severity based on operational impact.
Default rule
Severity is based on actual operational impact, not customer wording alone. A customer calling something “urgent” does not automatically make it Severity 1 or Severity 2.
If severity is not yet clear
Tier 1 may temporarily mark the issue as Needs Triage, but must actively revisit and finalize severity once sufficient facts are gathered.
Typical fast-escalation indicators
The following patterns should trigger high scrutiny and likely urgent escalation:
widespread login failure
multi-user or multi-tenant access failure
claims cannot be transmitted
EHR-to-RCM integration is materially broken
patient portal outage materially impacting customer operations
major outage or degradation of a core workflow
Important nuance
Not every prescribing-related issue is automatically urgent. Tier 1 should assess whether the issue is isolated, whether a workaround exists, whether the issue is materially blocking care or operations, and whether broader impact exists before classifying it as urgent. This is consistent with the policy principle that severity is impact-based.
Escalation standard
Use Linear when engineering review, investigation, remediation, or implementation work is needed.
Use Slack plus Linear when the issue is urgent or critical and needs immediate internal visibility.
Involve the Customer Support Manager when severity is unclear, stalled, sensitive, risky, or operationally significant.

Section 6. Authorization Check
Before taking any impactful action, Tier 1 must determine whether customer authorization is required.
General authorization rule
If the request changes access, permissions, configuration, templates, reports, exports, workflow, vendor-side settings, billing settings, or other material aspects of the customer environment, Tier 1 should assume authorization is required unless the Authority Matrix clearly states otherwise.
Common request types that require written approval from an authorized customer contact
creating a new user
granting access
modifying user roles or permissions
disabling or deactivating a user
provider setup changes
billing configuration changes
report requests or report logic changes
template or form changes
workflow-affecting changes
mass export requests
scoped services requests
advanced training requests
vendor-side settings changes initiated on behalf of the customer
CRM admin changes
ePrescribe settings changes
eMAR-related administrative changes
If requester is not clearly authorized
Tier 1 may:
investigate
ask clarifying questions
explain the approval requirement
identify the authorized customer contact on file
offer guidance where appropriate
Tier 1 may not:
perform the requested impactful action
route it for execution
create internal implementation work as though the request is approved
bypass the approval standard
If authority is unclear, conflicting, unusually risky, or security-related, Tier 1 should pause and escalate to management rather than guess.
Documentation requirement
Whenever action is taken based on customer approval, the support record must document:
who approved
when approval was received
what was approved
where approval was found
what action was taken

Section 7. Vendor Involvement Check
Tier 1 should determine whether vendor dependency is likely, but should not engage a vendor reflexively before completing reasonable internal triage.
Vendors and connected systems commonly involved
Imagine / Opus RCM
Phicure
Imagine Pay
LeadSquared / Opus CRM
DoseSpot
EIR / Advanced eMAR
Nabla
Before vendor engagement, Tier 1 should complete reasonable first-level triage whenever practical
This may include:
gathering a clear issue description
identifying customer, tenant, and affected users
determining whether issue is isolated or broad
confirming date and time of occurrence
determining recent changes if known
assessing business impact
determining whether the issue may instead be:
user error
training gap
approval issue
customer configuration issue
internal Opus issue
integration issue requiring internal engineering review first
Vendor engagement rule
Customers should not be told to coordinate directly with the vendor for standard support matters. Opus remains the customer-facing case owner. Tier 1 may and should coordinate behind the scenes as needed, document the vendor interaction internally, and continue updating the customer.
Customer-facing posture during vendor issues
Preferred posture:
“We are actively working this on our side and coordinating with the appropriate partner.”
“We’ve escalated this through the appropriate channels and will keep you updated.”
“Our team is still actively following up on this and we’ll continue to push it forward.”
Avoid:
telling the customer to contact the vendor
speaking as though Opus is no longer responsible
becoming passive after opening the vendor case

Section 8. Routing Paths
Once first-pass triage is complete, Tier 1 should route the issue to the correct path.
Route 1. Tier 1 resolves directly
Use when:
the issue falls within the Authority Matrix
sufficient information exists
authorization exists if required
no engineering, onboarding, or vendor dependency is needed
the work is routine support and not scoped work
Route 2. Senior Support
Use when:
Tier 1 is not confident in the classification
the issue is operationally tricky or stalled
judgment is needed
the issue requires higher support expertise
a risky action or uncertain policy interpretation exists
Route 3. Engineering via Linear
Use when:
engineering investigation is needed
system behavior appears broken beyond standard support handling
backend configuration or technical remediation is needed
integration logic may be involved
implementation work is required
Route 4. Slack plus Linear
Use when:
severity is urgent or critical
immediate engineering visibility is needed
live operational impact justifies urgent internal attention
Route 5. Onboarding / Implementation
Use when:
the issue is actually workflow redesign
the customer is asking for implementation-like changes
the matter belongs to scoped setup or onboarding consultation
the request is not ordinary support fulfillment
Route 6. Vendor Coordination
Use when:
reasonable triage suggests vendor dependency
vendor-side investigation or remediation is needed
the workflow is known to rely on a vendor-owned system
internal teams cannot fully resolve without vendor involvement
Route 7. Customer Approval Required
Use when:
the customer request cannot proceed without written approval from the authorized contact
investigation can continue, but no impactful action may occur until approval is received
Route 8. Customer Action Required
Use when:
the customer must provide needed information
the customer must test or confirm behavior
the customer must provide approval
the customer must complete an administrative step on their side
Route 9. Scoped Work / SOW Process
Use when:
the request involves custom work
the request requires clarified scope, pricing review, SOW creation, timeline definition, signatures, or formal sign-off
the request is not standard support work even if it originated as a support ticket

Section 9. Customer Communication Standard
For every non-immediate-resolution ticket, Tier 1 should communicate clearly and proactively.
The first customer response after triage should usually include:
acknowledgment of the issue
what Support currently understands
what is needed next, if anything
whether the issue is being reviewed internally or coordinated with another team or partner
when the customer should expect the next update
Default update rule
If a ticket remains open and pending internal or vendor action, the customer should receive proactive updates at least daily unless a different update expectation has been explicitly set. Silence should not be the default.
Communication principles
acknowledge impact
confirm ownership
explain the next step when possible
avoid overpromising
do not disappear
continue updates until resolved or a clearly communicated different cadence is agreed

Section 10. Ticket Documentation Standard
Every materially worked ticket should document enough information for another Opus team member to understand:
what the issue is
what it was classified as
what product area is involved
what severity was assigned or whether it is still Needs Triage
whether authorization was required
whether authorization was confirmed
what troubleshooting has already occurred
what route was chosen
whether a vendor, engineering team, onboarding, or management was engaged
what was communicated to the customer
what the next expected step is
Documentation should be strong enough to support:
handoff quality
engineering escalation quality
vendor escalation quality
approval traceability
management review

Section 11. Lightweight Required-Info Prompts by Issue Type
Tier 1 should gather as much of the following as practical without overcomplicating intake.
Access / SSO / Identity
customer account
requester
affected user
exact system affected
exact symptom
whether issue is isolated or broad
when issue started
whether the request also includes access change or permission change
whether authorization is required
Billing / RCM / Claims
customer account
affected workflow
claim, payer, patient/account reference if appropriate
date of service if relevant
exact symptom
whether issue is isolated or broad
whether claims transmission is blocked
whether manual workaround exists
ePrescribe
customer account
affected provider/user
exact workflow step failing
whether issue blocks prescribing entirely or partially
whether issue is isolated or broad
when the issue began
eMAR
customer account
affected user/workflow
exact medication-administration or access workflow issue
whether customer operations are materially blocked
whether the issue is isolated or broad
when the issue began
Reporting / Data
report name or output in question
what result appears wrong or what change is being requested
whether the request is troubleshooting vs change request vs scoped work
Vendor-Dependent Issues
Before contacting a vendor, gather as much as practical:
customer name
tenant/account
affected users
exact issue description
date and time of occurrence
steps to reproduce if known
whether issue is ongoing or intermittent
severity/business impact
workaround availability
troubleshooting already completed
PHI handling note
Tier 1 should avoid requesting screenshots by default where PHI exposure risk is unnecessary. If visual confirmation is truly needed, the rep should use good judgment and minimize unnecessary PHI handling.

Section 12. Failure Modes This SOP Is Designed to Prevent
This SOP exists in part to reduce the following common support failures:
acting before classification
taking impactful action without verified authorization
treating customer urgency as the same thing as internal severity
escalating weakly to engineering or vendors
punting too quickly to vendors
becoming passive while waiting on another team
doing scoped project work through ordinary support
confusing training gaps, configuration issues, and bugs
weak ticket documentation
poor handoffs between Support and Onboarding
Tier 1 and management should use this SOP to identify and correct those behaviors over time. This aligns with the broader support philosophy already established across the Opus policy set.

Section 13. Practical Examples
Example 1: End user requests new access
A staff member emails Support asking for access to RCM.
Correct handling:
classify product area as Access / SSO / Identity or Opus RCM / Imagine
classify issue type as service request
determine authorization is required
verify whether requester is an authorized admin or authorized account POC
if not authorized, respond helpfully and request written approval from the authorized contact on file
do not perform the access change before that approval exists
Example 2: Claims are not transmitting
A biller reports claims are stuck and cannot be sent.
Correct handling:
classify product area as Opus RCM / Imagine or Phicure / Clearinghouse
classify as support issue or outage/degradation depending on scope
assess severity based on actual claims-transmission impact
if materially blocking revenue flow, escalate through appropriate urgent path
document business impact
engage vendor or engineering if indicated
continue proactive customer updates
Example 3: Customer asks to redesign workflow with multiple forms
Correct handling:
classify product area as Clinical Documentation / Forms / Templates or Integrations
classify issue type as scoped work / SOW request
do not treat as routine ticket work
gather enough detail to understand request
route to onboarding / implementation / SOW process
Example 4: Customer says “urgent” but issue affects one user only
Correct handling:
acknowledge urgency professionally
assess actual impact
classify severity based on operations, not wording alone
resolve, escalate, or gather information as appropriate
do not automatically over-escalate solely because the word “urgent” was used
Example 5: ePrescribe issue appears vendor-related
Correct handling:
perform reasonable internal triage first
determine whether issue may instead be training, configuration, approval, or internal integration-related
if vendor dependency remains likely, coordinate with vendor behind the scenes
keep Opus as the customer-facing owner of the case

Final Operating Reminder
The goal of this SOP is not to make Tier 1 rigid. The goal is to make Tier 1 consistent, safe, proactive, and high quality.
Tier 1 should not guess, improvise high-risk decisions, or disappear behind internal or vendor dependency. The correct posture is:
classify clearly
verify authority where required
assess impact honestly
route correctly
document well
communicate proactively
keep ownership on the Opus side until the matter is truly resolved or properly transitioned

