# Phase 5: Self-Critique & Quality Layers

## Goal

Add a review layer that critiques every analysis before it reaches the UI. The reviewer catches generic action items, unsupported temperature assessments, missed context, and incorrect priority assignments — then triggers a refinement pass to fix them. The result: consistently higher-quality analysis output.

## Why This Matters

LLM outputs vary in quality. Some runs produce crisp, specific action items. Others produce vague platitudes like "follow up with the customer." Today there's no quality gate — whatever the model outputs goes straight to the board. Agents learn which analyses are good and which are useless, eroding trust in the system.

A review layer acts as a QA step. It's the equivalent of a senior agent reviewing the board before the team sees it.

---

## Current State

- `confidence` field (0.00-1.00) exists in `TicketActionBoardAnalysis` but is self-assessed by the same LLM call that produced the analysis — not independently validated
- No review or critique mechanism
- No quality metrics tracked over time
- All analysis output goes directly to the UI regardless of quality

---

## Target State

### Quality Pipeline

```
Pass Outputs (from Phase 2)
    ↓
Quality Review Pass (strong model)
    ↓ evaluates
Quality Score + Issue List
    ↓
    ├── Score >= threshold → Publish to UI
    │
    └── Score < threshold → Refinement Pass
                                ↓
                           Improved Output
                                ↓
                           Publish to UI
```

### Quality Dimensions

The review pass evaluates each analysis across these dimensions:

| Dimension | What It Checks | Example Failure |
|-----------|----------------|-----------------|
| **Specificity** | Are action items specific and self-contained? | "Follow up with customer" instead of "Reply to customer's March 20 email asking about the billing sync error, providing the ETA from LINEAR-4521" |
| **Accuracy** | Does the summary match the actual conversation? | Summary says "customer is happy" but conversation shows frustration |
| **Completeness** | Are all pending actions captured? | Customer asked 3 questions but only 1 action item was generated |
| **Temperature calibration** | Is the temperature supported by evidence? | Marked "calm" but customer used phrases like "extremely frustrated" |
| **Priority correctness** | Are priorities appropriate for urgency? | VIP customer waiting 4+ hours but action items marked "this_week" |
| **Actionability** | Can an agent execute each item without ambiguity? | "Check the issue" — check what? Where? How? |
| **Staleness awareness** | Do actions account for recent activity? | Suggests "reply to customer" but agent already replied 10 minutes ago |

---

## Implementation Details

### Step 1: Quality Review Pass

**New file:** `src/lib/ai/passes/quality-review-pass.ts`

```typescript
// Input: All pass results (situation, action items, temperature, etc.) + original ticket context
// Output: QualityReviewResult

interface QualityReviewResult {
  overall_score: number;        // 0.00-1.00
  dimension_scores: {
    specificity: number;        // 0.00-1.00
    accuracy: number;
    completeness: number;
    temperature_calibration: number;
    priority_correctness: number;
    actionability: number;
  };
  issues: QualityIssue[];
  pass_approved: boolean;       // overall_score >= threshold
}

interface QualityIssue {
  dimension: string;
  severity: 'critical' | 'warning' | 'suggestion';
  description: string;
  affected_field: string;       // e.g., 'action_items[0].description', 'customer_temperature'
  suggested_fix: string;
}
```

**System prompt for review pass:**

```
You are a quality reviewer for support ticket analyses. You are reviewing analysis
that will be shown to support agents on an operational action board.

Your job is to evaluate the analysis quality and identify specific issues.

REVIEW CRITERIA:

1. SPECIFICITY (0.00-1.00):
   - Every action item must be executable by someone with zero context
   - "Follow up" is NEVER acceptable — what exactly should they follow up about?
   - Include ticket numbers, names, dates, and specific details from the conversation
   - Score 0.0 if any action item is vague; 1.0 if every item is crystal clear

2. ACCURACY (0.00-1.00):
   - Does the situation summary accurately reflect the conversation?
   - Are there any factual errors (wrong names, dates, claims)?
   - Score 0.0 for material inaccuracies; 1.0 for complete accuracy

3. COMPLETENESS (0.00-1.00):
   - Count the pending actions visible in the conversation
   - Compare to the action items generated
   - Any missed action = score reduction
   - Score 0.0 if major actions missing; 1.0 if all captured

4. TEMPERATURE CALIBRATION (0.00-1.00):
   - Read the customer's actual words in the conversation
   - Is the temperature rating justified by evidence?
   - Over-rating (calm→angry) and under-rating (angry→calm) both score 0.0

5. PRIORITY CORRECTNESS (0.00-1.00):
   - VIP (Co-Destiny) tickets with waiting customers: all actions should be "now"
   - Customer waiting 4+ hours: at least one action should be "now"
   - Routine status updates: "this_week" is appropriate
   - Score 0.0 for egregiously wrong priorities

6. ACTIONABILITY (0.00-1.00):
   - Can an agent read the action item and immediately know what to do?
   - Are there ambiguous references ("check the issue", "update the team")?
   - Score 0.0 if agent would need to investigate before acting

For each issue found, provide:
- Which dimension it affects
- Severity (critical: blocks agent, warning: reduces quality, suggestion: nice to have)
- What's wrong
- Specific suggested fix

Output format:
OVERALL_SCORE: [weighted average]
DIMENSION_SCORES: [JSON object]
ISSUES: [JSON array of issues]
PASS_APPROVED: [true if overall_score >= 0.70]
```

**Model:** Use the strongest available model (Sonnet/Opus) — the reviewer needs strong reasoning to evaluate quality.

### Step 2: Refinement Pass

**New file:** `src/lib/ai/passes/refinement-pass.ts`

When the review identifies issues, this pass fixes them:

```typescript
// Input: Original pass results + QualityIssue[] from review
// Output: Corrected versions of the affected fields
//
// The refinement pass receives:
// 1. The original ticket context
// 2. The specific issues identified by the reviewer
// 3. The suggested fixes
//
// It then re-generates ONLY the affected fields with the issues addressed.
//
// Example: If the reviewer said action_items[0] is too vague,
// the refinement pass gets the full context + the specific feedback
// and generates a better version of that one action item.
```

This is targeted, not a full re-analysis. Only the flagged fields are regenerated.

### Step 3: Integrate into Orchestrator

**Modified file:** `src/lib/ai/passes/orchestrator.ts`

Add quality review as the final step of the pipeline:

```typescript
// After all passes complete:

// Run quality review
const qualityResult = await runQualityReviewPass(context, allPassResults);

// If quality passes threshold, publish
if (qualityResult.pass_approved) {
  const analysis = composeFinalAnalysis(ticketId, context, allPassResults);
  analysis.confidence = qualityResult.overall_score; // Use reviewer's score, not self-assessed
  await upsertAnalysis(analysis);
  return analysis;
}

// If quality fails, run refinement
const criticalIssues = qualityResult.issues.filter(i => i.severity === 'critical');
if (criticalIssues.length > 0) {
  const refinedResults = await runRefinementPass(context, allPassResults, criticalIssues);
  // Merge refined results into pass results
  const mergedResults = mergePassResults(allPassResults, refinedResults);
  const analysis = composeFinalAnalysis(ticketId, context, mergedResults);
  analysis.confidence = qualityResult.overall_score; // Keep original score (refined, but noted)
  await upsertAnalysis(analysis);
  return analysis;
}
```

### Step 4: Quality Metrics Storage

**New migration:** `supabase/migrations/XXX_quality_reviews.sql`

```sql
CREATE TABLE IF NOT EXISTS quality_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hubspot_ticket_id TEXT NOT NULL,
  overall_score DECIMAL(4,2) NOT NULL,
  dimension_scores JSONB NOT NULL,
  issues JSONB DEFAULT '[]',
  pass_approved BOOLEAN NOT NULL,
  refinement_triggered BOOLEAN DEFAULT FALSE,
  model_used TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_quality_reviews_ticket ON quality_reviews(hubspot_ticket_id);
CREATE INDEX idx_quality_reviews_created ON quality_reviews(created_at);
CREATE INDEX idx_quality_reviews_score ON quality_reviews(overall_score);
```

### Step 5: Quality Dashboard (Optional)

Add a quality metrics view accessible to VP RevOps:

- Average quality score over time (trend chart)
- Most common quality issues (what dimensions fail most?)
- Tickets with lowest quality scores (which tickets need attention?)
- Refinement trigger rate (how often does the first pass fail quality?)

This helps identify if the prompts need tuning or if certain ticket types consistently produce low-quality analysis.

### Step 6: Configurable Quality Threshold

**Environment variable:**
```env
QUALITY_REVIEW_THRESHOLD=0.70    # Minimum score to publish without refinement
QUALITY_REVIEW_ENABLED=true       # Toggle quality review on/off
QUALITY_MAX_REFINEMENT_ATTEMPTS=2 # Max times to retry before publishing anyway
```

In early deployment, set the threshold low (0.50) and monitor. Gradually raise it as prompt quality improves.

---

## Performance Considerations

The quality review adds one additional LLM call per analysis. With cheap models this is negligible, but it does add latency:

- **Full pipeline without review:** ~3-5 seconds (7 passes, some parallel)
- **Full pipeline with review:** ~5-7 seconds (+ review pass)
- **Full pipeline with review + refinement:** ~7-10 seconds (+ review + refinement)

For event-driven triggers (Phase 3), this latency is acceptable — 10 seconds from customer reply to updated UI is still excellent.

For batch analysis, the review adds significant time. Consider: skip quality review during batch re-analysis and only apply it for event-driven analysis where a single ticket is being processed.

---

## Testing Plan

1. **Quality scoring**: Run the review pass on 10 existing analyses. Verify scores are reasonable and issues are correctly identified
2. **Refinement**: Intentionally create a low-quality analysis (vague action items). Verify the review catches it and refinement improves it
3. **Threshold behavior**: Set threshold to 1.0 (always fails). Verify refinement triggers every time. Set to 0.0 (always passes). Verify refinement never triggers
4. **Metrics storage**: Verify quality_reviews table populates with correct scores and issues
5. **Latency measurement**: Time the full pipeline with and without quality review. Verify the additional latency is acceptable

---

## Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `src/lib/ai/passes/quality-review-pass.ts` | CREATE | Quality evaluation with dimension scoring |
| `src/lib/ai/passes/refinement-pass.ts` | CREATE | Targeted fix for quality issues |
| `src/lib/ai/passes/orchestrator.ts` | MODIFY | Integrate quality review + refinement into pipeline |
| `supabase/migrations/XXX_quality_reviews.sql` | CREATE | Quality metrics storage |
