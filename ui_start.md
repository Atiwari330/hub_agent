# Feature Implementation Prompt: Account Executive Detail View

## Overview

Build an Account Executive (AE) detail view for a RevOps intelligence application. This is a Next.js 15 application using TypeScript, TailwindCSS 4, Supabase for the database, and HubSpot as the CRM data source. The app already has HubSpot API integration set up in `src/lib/hubspot/`.

The AE detail view is a dedicated page that shows everything about a single sales rep: their quota attainment, pace to goal, pipeline value, at-risk deals, activity metrics, and a complete deal table.

---

## Navigation Structure

### Left Sidebar Navigation
Create a persistent left sidebar (width: 256px / w-64) with dark styling (bg-slate-900):

```
┌─────────────────────────┐
│ RevOps Agent            │
│ EHR Sales Intelligence  │
├─────────────────────────┤
│ ▼ Account Executives    │
│     ○ Amos              │
│     ○ Christopher       │
│     ○ Jack              │
├─────────────────────────┤
│   Leads                 │
├─────────────────────────┤
│ Last sync: [timestamp]  │
│ Q1 2025 • Day X of 90   │
└─────────────────────────┘
```

- The "Account Executives" section is expandable/collapsible
- Each AE name is clickable and navigates to their detail view
- Show a small badge next to each AE name with their "at-risk" deal count (if > 0)
- Active/selected AE should be highlighted (bg-indigo-600)
- The sidebar footer shows last HubSpot sync timestamp and current quarter progress

### Routing
- `/dashboard/ae/[ownerId]` - AE detail view
- `/dashboard/leads` - Leads view (separate feature, not part of this prompt)

---

## Database Schema

### Table: `quotas`
Stores quarterly quota targets per AE. This must be manually entered by the user.

```sql
CREATE TABLE quotas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id VARCHAR(50) NOT NULL,           -- HubSpot owner ID
  owner_email VARCHAR(255) NOT NULL,       -- For easier lookups
  quarter VARCHAR(10) NOT NULL,            -- Format: 'Q1 2025', 'Q2 2025', etc.
  quota_amount DECIMAL(12,2) NOT NULL,     -- e.g., 420000.00
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(owner_id, quarter)
);

CREATE INDEX idx_quotas_owner_quarter ON quotas(owner_id, quarter);
```

### Table: `owners` (should already exist)
Synced from HubSpot. Contains AE information.

```sql
CREATE TABLE owners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hubspot_owner_id VARCHAR(50) UNIQUE NOT NULL,
  email VARCHAR(255),
  first_name VARCHAR(100),
  last_name VARCHAR(100),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Table: `deals` (should already exist)
Synced from HubSpot. Contains deal information.

```sql
CREATE TABLE deals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hubspot_deal_id VARCHAR(50) UNIQUE NOT NULL,
  deal_name VARCHAR(500),
  amount DECIMAL(12,2),
  deal_stage VARCHAR(100),
  pipeline_id VARCHAR(50),
  owner_id VARCHAR(50),                    -- HubSpot owner ID
  close_date DATE,
  create_date TIMESTAMPTZ,
  days_in_current_stage INTEGER,
  last_activity_date TIMESTAMPTZ,
  deal_stage_entered_at TIMESTAMPTZ,       -- When deal entered current stage
  hubspot_owner_id VARCHAR(50),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_deals_owner ON deals(owner_id);
CREATE INDEX idx_deals_stage ON deals(deal_stage);
CREATE INDEX idx_deals_close_date ON deals(close_date);
```

### Table: `sentiment_analyses` (should already exist)
Stores AI sentiment analysis results per deal.

```sql
CREATE TABLE sentiment_analyses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id VARCHAR(50) NOT NULL,            -- HubSpot deal ID
  sentiment VARCHAR(20) NOT NULL,          -- 'positive', 'neutral', 'at-risk'
  confidence DECIMAL(3,2),                 -- 0.00 to 1.00
  reasoning TEXT,
  analyzed_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sentiment_deal ON sentiment_analyses(deal_id);
```

---

## Metric Calculations

### 1. Quota Progress
**What it shows:** Closed won revenue vs. quarterly quota target

**Calculation:**
```typescript
// Get quota from database
const quota = await supabase
  .from('quotas')
  .select('quota_amount')
  .eq('owner_id', ownerId)
  .eq('quarter', currentQuarter) // e.g., 'Q1 2025'
  .single();

// Get closed won deals for this quarter
const closedWonDeals = await supabase
  .from('deals')
  .select('amount')
  .eq('owner_id', ownerId)
  .eq('deal_stage', 'closedwon') // Use your actual HubSpot stage ID
  .gte('close_date', quarterStartDate) // e.g., '2025-01-01'
  .lte('close_date', quarterEndDate);  // e.g., '2025-03-31'

const closedRevenue = closedWonDeals.reduce((sum, deal) => sum + (deal.amount || 0), 0);
const quotaPercent = (closedRevenue / quota.quota_amount) * 100;
```

**Display:**
- Large number: Closed revenue (e.g., "$52,000")
- Subtext: "of $420,000"
- Progress bar showing percentage
- Color: Green if >= expected pace, Amber if within 10%, Red if behind

### 2. Pace to Goal
**What it shows:** Whether the AE is ahead or behind where they should be based on linear quota distribution across the quarter

**Calculation:**
```typescript
// Calculate quarter progress
const quarterStartDate = new Date('2025-01-01'); // Start of Q1
const quarterEndDate = new Date('2025-03-31');   // End of Q1
const today = new Date();

const totalDaysInQuarter = Math.ceil((quarterEndDate - quarterStartDate) / (1000 * 60 * 60 * 24));
const daysElapsed = Math.ceil((today - quarterStartDate) / (1000 * 60 * 60 * 24));
const quarterProgressPercent = daysElapsed / totalDaysInQuarter;

// Expected closed by now (linear distribution)
const expectedClosedByNow = quota.quota_amount * quarterProgressPercent;

// Pace calculation
const pace = closedRevenue - expectedClosedByNow;
const isOnTrack = pace >= 0;
```

**Display:**
- Large number: Pace amount with +/- sign (e.g., "+$12,000" or "-$28,000")
- Subtext: "ahead of pace" or "behind pace"
- Icon: TrendUp (green) if positive, TrendDown (red) if negative

### 3. Pipeline Value
**What it shows:** Total value of all active deals (excludes Closed Won, Closed Lost, and MQL)

**Calculation:**
```typescript
// Define excluded stages - adjust based on your HubSpot pipeline configuration
const EXCLUDED_STAGES = [
  'closedwon',
  'closedlost', 
  'mql',
  'disqualified'
];

const activeDeals = await supabase
  .from('deals')
  .select('amount, deal_stage')
  .eq('owner_id', ownerId)
  .not('deal_stage', 'in', `(${EXCLUDED_STAGES.join(',')})`);

const pipelineValue = activeDeals.reduce((sum, deal) => sum + (deal.amount || 0), 0);
const activeDealCount = activeDeals.length;

// Calculate pipeline coverage ratio
const remainingQuota = quota.quota_amount - closedRevenue;
const pipelineCoverage = remainingQuota > 0 ? pipelineValue / remainingQuota : null;
```

**Display:**
- Large number: Pipeline value (e.g., "$892,000")
- Subtext: "X active deals"
- Coverage ratio: "2.1x coverage" with color coding:
  - Green: >= 3x (healthy)
  - Amber: >= 2x and < 3x (adequate)  
  - Red: < 2x (needs attention)

### 4. Deals at Risk
**What it shows:** Count of deals that have risk indicators

**Risk Criteria (a deal is "at risk" if ANY of these are true):**
```typescript
interface DealRiskCriteria {
  // 1. Stalled in stage too long
  daysInStageThreshold: 14, // Days before flagging as stalled
  
  // 2. Negative AI sentiment
  sentimentIsAtRisk: true, // From sentiment_analyses table
  
  // 3. Close date is past due
  closeDatePassed: true, // close_date < today AND not closed won/lost
  
  // 4. No activity in X days
  noActivityDays: 10, // No logged activity in last 10 days
  
  // 5. Close date approaching with no recent activity
  closeDateApproaching: 7, // Close date within 7 days
  noRecentActivity: 5      // AND no activity in 5 days
}
```

**Calculation:**
```typescript
const atRiskDeals = await supabase
  .from('deals')
  .select(`
    hubspot_deal_id,
    deal_name,
    amount,
    deal_stage,
    days_in_current_stage,
    close_date,
    last_activity_date,
    sentiment_analyses!inner(sentiment)
  `)
  .eq('owner_id', ownerId)
  .not('deal_stage', 'in', '(closedwon,closedlost,mql,disqualified)');

const riskyDeals = atRiskDeals.filter(deal => {
  const today = new Date();
  const closeDate = new Date(deal.close_date);
  const lastActivity = new Date(deal.last_activity_date);
  const daysSinceActivity = Math.ceil((today - lastActivity) / (1000 * 60 * 60 * 24));
  const daysUntilClose = Math.ceil((closeDate - today) / (1000 * 60 * 60 * 24));
  
  // Check risk conditions
  const isStalled = deal.days_in_current_stage > 14;
  const hasNegativeSentiment = deal.sentiment_analyses?.sentiment === 'at-risk';
  const isPastDue = closeDate < today;
  const isInactive = daysSinceActivity > 10;
  const isApproachingWithNoActivity = daysUntilClose <= 7 && daysSinceActivity > 5;
  
  return isStalled || hasNegativeSentiment || isPastDue || isInactive || isApproachingWithNoActivity;
});

const atRiskCount = riskyDeals.length;
const atRiskValue = riskyDeals.reduce((sum, deal) => sum + (deal.amount || 0), 0);
```

**Display:**
- Large number: Count of at-risk deals (colored red if > 2, amber if > 0, green if 0)
- Subtext: Total value at risk (e.g., "$282,000 at risk")
- Small alert icon if count > 0

---

## API Endpoints

### GET `/api/ae/[ownerId]/metrics`
Returns all calculated metrics for a single AE.

**Response:**
```typescript
interface AEMetricsResponse {
  owner: {
    id: string;
    hubspotOwnerId: string;
    email: string;
    firstName: string;
    lastName: string;
  };
  quarter: string;              // 'Q1 2025'
  daysIntoQuarter: number;      // e.g., 6
  totalDaysInQuarter: number;   // e.g., 90
  quotaProgress: {
    quota: number;              // 420000
    closed: number;             // 52000
    percent: number;            // 12.38
  };
  paceToGoal: {
    expectedByNow: number;      // 28000
    actual: number;             // 52000
    pace: number;               // 24000 (positive = ahead)
    isOnTrack: boolean;
  };
  pipeline: {
    value: number;              // 892000
    dealCount: number;          // 7
    coverageRatio: number;      // 2.42
    coverageHealth: 'healthy' | 'adequate' | 'low';
  };
  atRisk: {
    count: number;              // 2
    value: number;              // 282000
    deals: AtRiskDeal[];        // Summary of risky deals
  };
  activityStats: {
    avgDealSize: number;
    avgSalesCycleDays: number;
    winRate: number;
    activitiesThisWeek: number;
    meetingsThisWeek: number;
  };
}
```

### GET `/api/ae/[ownerId]/deals`
Returns all deals for a single AE with enriched data.

**Query params:**
- `stage` - Filter by stage (optional)
- `sortBy` - Sort field: 'closeDate', 'amount', 'daysInStage', 'sentiment' (default: 'closeDate')
- `sortOrder` - 'asc' or 'desc' (default: 'asc')

**Response:**
```typescript
interface AEDealsResponse {
  deals: Deal[];
  totalCount: number;
  totalValue: number;
}

interface Deal {
  id: string;
  hubspotDealId: string;
  name: string;
  amount: number;
  stage: string;
  stageName: string;           // Human-readable stage name
  daysInStage: number;
  closeDate: string;
  probability: number;
  lastActivityDate: string;
  lastActivityDaysAgo: number;
  nextStep: string | null;
  sentiment: 'positive' | 'neutral' | 'at-risk';
  sentimentReasoning: string | null;
  contactCount: number;
  stakeholders: string[];      // e.g., ['CIO', 'CFO', 'IT Director']
  riskFlags: string[];         // e.g., ['Stalled 18 days', 'No recent activity']
}
```

### POST `/api/ae/[ownerId]/quota`
Create or update quota for an AE.

**Request body:**
```typescript
interface SetQuotaRequest {
  quarter: string;    // 'Q1 2025'
  amount: number;     // 420000
}
```

---

## UI Components

### 1. AE Header
```
┌────────────────────────────────────────────────────────────────┐
│ [Avatar]  Amos                                    [AI Summary] │
│           Account Executive • amos@company.com                 │
└────────────────────────────────────────────────────────────────┘
```
- Avatar: 64x64 circle with initials (bg-indigo-100, text-indigo-700)
- Name: text-2xl font-semibold
- Subtitle: text-slate-500
- AI Summary button: Triggers AI agent to generate natural language summary

### 2. Metrics Cards Row (4 cards in a grid)
```
┌─────────────────┬─────────────────┬─────────────────┬─────────────────┐
│ Q1 Quota        │ Pace to Goal    │ Pipeline Value  │ Deals at Risk   │
│ $52,000         │ +$24,000        │ $892,000        │ 2               │
│ of $420,000     │ ahead of pace   │ 7 active deals  │ $282,000 at risk│
│ [████░░░░] 12%  │ ↑ On track      │ 2.4x coverage   │ ⚠ Requires rev. │
└─────────────────┴─────────────────┴─────────────────┴─────────────────┘
```
- Each card: bg-white rounded-xl border border-slate-200 p-5
- Primary metric: text-3xl font-semibold
- Progress bars where applicable
- Color coding based on health

### 3. Activity Stats Bar
A horizontal bar showing historical performance metrics:
```
┌────────────────────────────────────────────────────────────────────────┐
│ Avg Deal Size   │ Avg Sales Cycle │ Win Rate │ Activities │ Meetings  │
│ $127,429        │ 78 days         │ 32%      │ 23         │ 6         │
└────────────────────────────────────────────────────────────────────────┘
```
- Background: bg-slate-50 rounded-xl p-4
- Metrics separated by vertical dividers
- Labels: text-xs text-slate-500 uppercase tracking-wide
- Values: text-lg font-semibold

### 4. Deals Table
Full-width table with sortable columns:

**Columns:**
| Column | Width | Content |
|--------|-------|---------|
| Account | flex | Deal name + stakeholder summary |
| Value | 100px | Currency formatted |
| Stage | 140px | Colored badge |
| Days in Stage | 100px | Number + warning icon if > 14 |
| Close Date | 100px | Date formatted |
| Sentiment | 100px | Colored badge |
| Next Step | flex | Truncated text |

**Styling:**
- Header row: bg-slate-50, text-xs uppercase tracking-wider text-slate-500
- Body rows: hover:bg-slate-50, cursor-pointer
- Alternating row colors NOT needed (use hover state instead)
- Stalled deals (>14 days): Show red alert icon next to days count
- At-risk sentiment: Red badge
- Positive sentiment: Green badge
- Neutral sentiment: Gray badge

### 5. Stage Badge Colors
Map your HubSpot stages to colors:
```typescript
const STAGE_COLORS: Record<string, string> = {
  'qualification': 'bg-slate-200 text-slate-700',
  'discovery': 'bg-blue-100 text-blue-800',
  'demo_scheduled': 'bg-indigo-100 text-indigo-800',
  'demo_completed': 'bg-violet-100 text-violet-800',
  'proposal_sent': 'bg-purple-100 text-purple-800',
  'negotiation': 'bg-amber-100 text-amber-800',
  'closedwon': 'bg-emerald-100 text-emerald-800',
  'closedlost': 'bg-red-100 text-red-800',
};
```

---

## HubSpot API Integration

### Fetching Deals by Owner
Use the HubSpot CRM API to fetch deals. You likely already have this in `src/lib/hubspot/`.

```typescript
// Required deal properties to fetch
const DEAL_PROPERTIES = [
  'dealname',
  'amount',
  'dealstage',
  'pipeline',
  'hubspot_owner_id',
  'closedate',
  'createdate',
  'hs_lastmodifieddate',
  'notes_last_updated',
  'num_associated_contacts',
  'hs_deal_stage_probability',
  'description',
  'hs_next_step'
];

// Fetch deals for an owner
async function getDealsByOwner(ownerId: string): Promise<Deal[]> {
  const response = await hubspotClient.crm.deals.searchApi.doSearch({
    filterGroups: [{
      filters: [{
        propertyName: 'hubspot_owner_id',
        operator: 'EQ',
        value: ownerId
      }]
    }],
    properties: DEAL_PROPERTIES,
    limit: 100
  });
  
  return response.results;
}
```

### Calculating Days in Current Stage
HubSpot doesn't directly provide this. Calculate it from deal history or store it during sync:

```typescript
// Option 1: Fetch deal stage history via API
async function getDealStageHistory(dealId: string) {
  // Use the properties history API or timeline API
  // This is complex - consider calculating during nightly sync instead
}

// Option 2: Calculate during sync and store in your deals table
// When syncing deals, compare current stage to previous sync
// If stage changed, reset days_in_current_stage to 0
// If stage same, increment days_in_current_stage
```

### Fetching Engagements for Activity Data
```typescript
// Get recent activities for a deal
async function getDealEngagements(dealId: string) {
  const engagements = await hubspotClient.crm.deals.associationsApi.getAll(
    dealId,
    'engagements'
  );
  // Filter and count by type: calls, emails, meetings, notes, tasks
}
```

---

## Quarter Utility Functions

```typescript
// src/lib/utils/quarter.ts

export function getCurrentQuarter(): string {
  const now = new Date();
  const month = now.getMonth();
  const year = now.getFullYear();
  const quarter = Math.floor(month / 3) + 1;
  return `Q${quarter} ${year}`;
}

export function getQuarterDates(quarter: string): { start: Date; end: Date } {
  // Parse "Q1 2025" format
  const [q, year] = quarter.split(' ');
  const quarterNum = parseInt(q.replace('Q', ''));
  const yearNum = parseInt(year);
  
  const startMonth = (quarterNum - 1) * 3;
  const start = new Date(yearNum, startMonth, 1);
  const end = new Date(yearNum, startMonth + 3, 0); // Last day of quarter
  
  return { start, end };
}

export function getQuarterProgress(quarter: string): { 
  daysElapsed: number; 
  totalDays: number; 
  percentComplete: number 
} {
  const { start, end } = getQuarterDates(quarter);
  const now = new Date();
  
  const totalDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  const daysElapsed = Math.max(0, Math.ceil((now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));
  const percentComplete = Math.min(100, (daysElapsed / totalDays) * 100);
  
  return { daysElapsed, totalDays, percentComplete };
}
```

---

## File Structure

```
src/
├── app/
│   ├── dashboard/
│   │   ├── layout.tsx              # Sidebar layout wrapper
│   │   ├── ae/
│   │   │   └── [ownerId]/
│   │   │       └── page.tsx        # AE detail page
│   │   └── leads/
│   │       └── page.tsx            # Leads page (future)
│   └── api/
│       └── ae/
│           └── [ownerId]/
│               ├── metrics/
│               │   └── route.ts    # GET metrics endpoint
│               ├── deals/
│               │   └── route.ts    # GET deals endpoint
│               └── quota/
│                   └── route.ts    # POST quota endpoint
├── components/
│   ├── layout/
│   │   └── Sidebar.tsx             # Left navigation sidebar
│   ├── ae/
│   │   ├── AEHeader.tsx            # Name, avatar, AI summary button
│   │   ├── MetricsCard.tsx         # Reusable metric card
│   │   ├── MetricsRow.tsx          # 4-card metrics grid
│   │   ├── ActivityStatsBar.tsx    # Horizontal stats bar
│   │   ├── DealsTable.tsx          # Sortable deals table
│   │   └── DealRow.tsx             # Individual deal row
│   └── ui/
│       ├── Badge.tsx               # Stage/sentiment badges
│       ├── ProgressBar.tsx         # Quota progress bars
│       └── Icons.tsx               # SVG icon components
├── lib/
│   ├── hubspot/                    # Existing HubSpot integration
│   ├── supabase/                   # Existing Supabase client
│   └── utils/
│       ├── quarter.ts              # Quarter calculation utilities
│       ├── currency.ts             # Currency formatting
│       └── risk.ts                 # Deal risk assessment logic
└── types/
    └── ae.ts                       # TypeScript interfaces
```

---

## Error Handling & Edge Cases

1. **No quota set**: If quota not found for current quarter, show a prompt to set quota with an inline form or modal.

2. **No deals**: Show empty state with message "No active deals. Time to build pipeline!"

3. **New AE (0 closed, 0 pipeline)**: Handle division by zero in coverage ratio. Display "N/A" or "∞" for coverage if remaining quota is 0.

4. **Deal missing amount**: Treat null/undefined amounts as $0 in calculations. Consider flagging these deals.

5. **Stale data**: Show last sync timestamp prominently. Consider showing a warning if last sync > 6 hours ago.

6. **API rate limits**: Implement caching. Metrics should be cached in Supabase and refreshed via cron, not calculated on every page load.

---

## Performance Considerations

1. **Pre-calculate metrics during sync**: Don't calculate metrics on every page load. Use the nightly cron job to:
   - Sync HubSpot data to Supabase
   - Calculate and store days_in_current_stage
   - Run sentiment analysis
   - Pre-calculate AE metrics and store in a `ae_metrics_cache` table

2. **Index your tables**: Ensure indexes on:
   - `deals.owner_id`
   - `deals.deal_stage`
   - `deals.close_date`
   - `quotas.owner_id, quotas.quarter`

3. **Paginate deals**: If an AE has many deals (unlikely but possible), paginate the deals table.

---

## Implementation Order

1. **Database**: Run migrations to add `quotas` table and any missing columns on `deals`
2. **Utilities**: Create quarter.ts, currency.ts, risk.ts utility functions
3. **API Routes**: Build the three API endpoints
4. **Sidebar**: Build the sidebar component with AE list
5. **Layout**: Create the dashboard layout with sidebar
6. **Metrics Row**: Build the 4 metric cards
7. **Activity Stats**: Build the horizontal stats bar
8. **Deals Table**: Build the sortable table with all columns
9. **Integration**: Wire up the page to fetch from APIs
10. **Quota Management**: Add ability to set/edit quotas

---

## Testing Checklist

- [ ] Metrics calculate correctly with test data
- [ ] Pace shows negative when behind, positive when ahead
- [ ] Coverage ratio handles edge cases (0 remaining quota)
- [ ] Risk flags appear on correct deals
- [ ] Sorting works on all columns
- [ ] Empty states display correctly
- [ ] Quota CRUD works
- [ ] Page loads in under 2 seconds
- [ ] Mobile responsive (optional, but sidebar should collapse)

---

## Sample Test Data

For initial testing, seed these quotas:
```sql
INSERT INTO quotas (owner_id, owner_email, quarter, quota_amount) VALUES
('hubspot_owner_id_for_amos', 'aboyd@opusbehavioral.com', 'Q1 2025', 420000),
('hubspot_owner_id_for_christopher', 'cgarraffa@opusbehavioral.com', 'Q1 2025', 420000),
('hubspot_owner_id_for_jack', 'jrice@opusbehavioral.com', 'Q1 2025', 420000);
```

Replace `hubspot_owner_id_for_*` with actual HubSpot owner IDs from your `owners` table.