# Feature Ideas Backlog

Ideas for future iterations, captured as they come up. Not committed to building yet.

---

## Idea 1: One-Click Task Creation (Asana Integration)

**Date:** 2026-01-03
**Status:** Idea stage

**Problem:**
When viewing deals requiring action in Mission Control, the next step is often to create a task for someone to follow up. Currently this requires context-switching to Asana, creating the task manually, and copying deal context.

**Concept:**
Add a button on exception cards that creates an Asana task in a configured project with one click.

**Variations to consider:**
1. **Adi's deals** → Create task for a specific person (ops team member who updates deal properties)
2. **Other AE deals** → Create task assigned to that AE to complete the action
3. **Configurable per-AE** → Each AE could have different task routing rules

**Implementation notes:**
- Would need Asana API integration
- Task should include deal context (name, amount, exception type, HubSpot link)
- Could have pre-configured "task templates" per exception type
- Consider: should this also log an activity in HubSpot?

**Questions to resolve:**
- Which Asana workspace/project?
- Should task assignment be configurable per AE or per exception type?
- Should it update the deal status in HubSpot when task is created?

---

## Idea 2: [Next idea goes here]

**Date:**
**Status:**

---
