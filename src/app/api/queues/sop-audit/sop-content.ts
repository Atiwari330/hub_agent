/**
 * Compressed SOP reference text for LLM prompts.
 * Distills all 5 SOP documents into a structured reference (~3,500 tokens)
 * optimized for classification + compliance evaluation.
 */

export function getSopReferenceText(): string {
  return `=== OPUS SUPPORT SOP REFERENCE ===

PRODUCT AREAS (choose one):
1. Opus EHR — core electronic health record
2. Clinical Documentation / Forms / Templates — note templates, form builds, clinical doc workflows
3. Opus RCM / Imagine — revenue cycle, billing, claims processing
4. Phicure / Clearinghouse — claim transmission, payer connectivity, clearinghouse routing
5. Imagine Pay / Payments — payment processing, patient payments, payment portal
6. Opus CRM / LeadSquared — CRM platform, lead management, marketing automation
7. DoseSpot / ePrescribe — electronic prescribing, EPCS, prescription workflows
8. Advanced eMAR / EIR Systems — medication administration records, eMAR workflows
9. Nabla / Copilot — AI copilot, documentation assistance
10. Access / SSO / Identity — login, SSO, MFA, user access, identity management
11. Reporting / Data — reports, dashboards, data exports, analytics
12. Integrations — cross-system integrations, data sync, API issues
13. Unknown / Needs Triage — insufficient info to classify

Disambiguation:
- Login/access issue = Access / SSO / Identity (even if it blocks another product)
- Claim submission problem = Opus RCM / Imagine OR Phicure / Clearinghouse depending on layer
- Note template change = Clinical Documentation / Forms / Templates
- Payment processor issue = Imagine Pay / Payments
- Prescribing issue = DoseSpot / ePrescribe
- Medication administration = Advanced eMAR / EIR Systems
- AI copilot = Nabla / Copilot
- Report concern = Reporting / Data
- Multi-system issue = Integrations

ISSUE TYPES (choose one):
1. Support Issue — existing function broken, unavailable, failing, not behaving as expected
2. Service Request — customer asks for an allowed operational/admin action within existing environment
3. Change Request — customer wants something changed from current state (discrete, specific)
4. Training Request — customer asking how to do something, understanding workflows, system is not necessarily broken
5. Scoped Work / SOW Request — custom work, redesign, implementation-like, project-style deliverables (bulk builds, workflow redesign, custom reports, mass exports, advanced training)
6. Outage / Degradation — broader live issue affecting critical workflow, multiple users/accounts
7. Unknown / Needs Investigation — cannot classify responsibly from available info

Decision logic:
- "Something is not working" → Support Issue (investigate if user error, config issue, training gap, or actual bug)
- "Change something specific" → Change Request (unless scope is large → Scoped Work)
- "How do I...?" → Training Request (unless system is actually broken)
- Redesign/bulk/custom deliverables → Scoped Work / SOW

SEVERITY LEVELS:
- sev_1 (Critical/Urgent): Materially blocks mission-critical workflow. Multi-user/multi-tenant impact. No reasonable workaround. Examples: broad login failure, claims can't transmit, EHR-RCM integration broken, prescribing blocked, major outage.
- sev_2 (High Priority): Serious/painful but operations continue. Workaround exists. Impaired not stopped. Examples: billing rules incorrect but manual work possible, queue logic causing rework, defect disrupting but not blocking.
- sev_3 (Standard): Isolated, low operational impact, routine. Examples: how-to questions, minor defects, non-urgent troubleshooting, informational requests.
- needs_triage: Severity not yet clear from available info.

Key rule: Severity = actual operational impact, NOT customer wording. "Urgent" from customer ≠ automatic sev_1.

ROUTING PATHS (choose one):
1. Tier 1 Resolves — within authority matrix, sufficient info, no engineering/vendor dependency
2. Senior Support — classification uncertain, operationally tricky, risky action, judgment needed
3. Engineering (Linear) — system behavior broken beyond support, backend config, integration logic, implementation work
4. Urgent Engineering (Slack + Linear) — sev_1, immediate engineering visibility needed, live operational impact
5. Onboarding / Implementation — workflow redesign, implementation-like changes, scoped setup
6. Vendor Coordination — vendor dependency confirmed after reasonable internal triage
7. Customer Approval Required — impactful action needs written approval from authorized contact
8. Customer Action Required — customer must provide info, test, confirm, or complete admin step
9. Scoped Work / SOW — custom work requiring scope/pricing/SOW/sign-off

AUTHORIZATION RULES:
Requires written approval from authorized account POC/admin:
- User creation, access grants, user disablement, role/permission changes
- Provider setup changes, billing config changes
- Template/form changes, report requests, report logic changes
- Workflow-affecting changes, mass exports, scoped services
- Vendor-side settings changes, CRM admin changes, ePrescribe settings, eMAR admin changes

Does NOT require authorization:
- Answering how-to questions, educational guidance
- Basic troubleshooting, routine status updates
- Contacting vendors for case progression

STRICT PROHIBITIONS:
- NEVER create users or grant access based on end-user request alone
- NEVER rely on verbal/implied/unclear approval
- NEVER bypass authorization because customer is pressuring

Documentation requirement: When acting on approval, record WHO approved, WHEN, WHAT was approved, WHERE approval was found, WHAT action was taken.

VENDOR COORDINATION:
Pre-vendor triage required — before contacting vendor, gather: clear description, affected users/accounts, isolated vs broad, timestamps, recent changes, business impact, whether issue is actually user error/training/config/internal.
Ownership rules: Opus remains customer-facing owner. Never tell customer to contact vendor directly. Never become passive after opening vendor case. Continue daily updates. Push vendor for responses. Escalate internally if vendor is slow.
Customer-facing language: "We are actively working this on our side and coordinating with the appropriate partner."

TRIAGE CHECKLIST (12 items for every ticket):
1. Identify customer account
2. Identify requester
3. Identify affected user/workflow/area
4. Identify/estimate product area
5. Identify issue type
6. Determine: support issue, service request, change request, training, or scoped work
7. Determine severity (or mark Needs Triage temporarily)
8. Determine if customer authorization required
9. Determine if vendor dependency likely
10. Determine correct routing path
11. Send initial response confirming ownership + next step
12. Document ticket clearly

COMMUNICATION STANDARD:
- First response: acknowledge issue, state understanding, explain next step, set update expectation
- Default: proactive updates at least daily while ticket is open/pending
- Principles: acknowledge impact, confirm ownership, explain next step, avoid overpromising, never disappear
- Ownership language: speak as Opus, not as individual. Even pending vendor = Opus still owns.

DOCUMENTATION STANDARD:
Every ticket must document: what the issue is, classification, product area, severity, whether auth required/confirmed, troubleshooting done, route chosen, whether vendor/engineering/management engaged, what customer was told, next expected step.
Must support: handoff quality, engineering escalation quality, vendor escalation quality, approval traceability, management review.`;
}
