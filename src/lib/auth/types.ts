export type UserRole = 'vp_revops' | 'cmo' | 'ceo' | 'account_executive' | 'cs_manager' | 'support_agent';

export interface UserWithPermissions {
  id: string;
  email: string;
  displayName: string | null;
  role: UserRole;
  permissions: string[];
  hubspotOwnerId?: string;
}

// Resource keys for permission checks
export const RESOURCES = {
  DASHBOARD: 'dashboard',
  AE_DETAIL: 'ae_detail',
  QUEUE_HYGIENE: 'queue:hygiene',
  QUEUE_NEXT_STEP: 'queue:next-step',
  QUEUE_OVERDUE_TASKS: 'queue:overdue-tasks',
  QUEUE_STALLED_DEALS: 'queue:stalled-deals',
  QUEUE_STALLED_UPSELLS: 'queue:stalled-upsells',
  QUEUE_UPSELL_HYGIENE: 'queue:upsell-hygiene',
  QUEUE_PPL_SEQUENCE: 'queue:ppl-sequence',
  QUEUE_AT_RISK: 'queue:at-risk',
  QUEUE_CS_HYGIENE: 'queue:cs-hygiene',
  QUEUE_PRE_DEMO_PIPELINE: 'queue:pre-demo-pipeline',
  QUEUE_SUPPORT_PULSE: 'queue:support-pulse',
  QUEUE_PITCH_QUEUE: 'queue:pitch-queue',
  QUEUE_SUPPORT_INTEL: 'queue:support-intel',
  QUEUE_FOLLOW_UP: 'queue:follow-up-queue',
  QUEUE_DEAL_COACH: 'queue:deal-coach',
  QUEUE_DOMAIN_ENRICHMENT: 'queue:domain-enrichment',
  QUEUE_COMPLIANCE_RESEARCH: 'queue:compliance-research',
  QUEUE_DEAL_HEALTH: 'queue:deal-health',
  QUEUE_SUPPORT_QUALITY: 'queue:support-quality',
  QUEUE_RCM_AUDIT: 'queue:rcm-audit',
  QUEUE_SUPPORT_MANAGER: 'queue:support-manager',
  QUEUE_PRE_DEMO_COACH: 'queue:pre-demo-coach',
  QUEUE_SUPPORT_TRAINER: 'queue:support-trainer',
  QUEUE_SUPPORT_ACTION_BOARD: 'queue:support-action-board',
  API_AGENT: 'api:agent',
  PORTAL: 'portal',
  HOT_TRACKER: 'hot_tracker',
  DEMO_TRACKER: 'demo_tracker',
  AE_HOME: 'ae_home',
  QUEUE_ENRICHMENT_VIEW: 'queue:enrichment-view',
  ANALYZE_TICKET: 'analyze:ticket',
  STRATEGIC_DIRECTIVES: 'strategic:directives',
  MORNING_BRIEFING: 'morning_briefing',
  PPL_DASHBOARD: 'ppl_dashboard',
} as const;

export type Resource = (typeof RESOURCES)[keyof typeof RESOURCES];

/**
 * Check if the current user has permission for a specific resource
 * This is a pure function that can be used in both client and server components
 */
export function hasPermission(
  user: UserWithPermissions | null,
  resource: Resource
): boolean {
  if (!user) {
    return false;
  }

  // VP of RevOps has access to everything
  if (user.role === 'vp_revops') {
    return true;
  }

  return user.permissions.includes(resource);
}

/**
 * Map URL pathname to resource key for permission checks
 */
export function getResourceFromPath(pathname: string): Resource | null {
  // Portal pages
  if (pathname.startsWith('/portal')) return RESOURCES.PORTAL;

  // Queue pages
  if (pathname.includes('/queues/hygiene')) return RESOURCES.QUEUE_HYGIENE;
  if (pathname.includes('/queues/next-step')) return RESOURCES.QUEUE_NEXT_STEP;
  if (pathname.includes('/queues/overdue-tasks'))
    return RESOURCES.QUEUE_OVERDUE_TASKS;
  if (pathname.includes('/queues/stalled-deals'))
    return RESOURCES.QUEUE_STALLED_DEALS;
  if (pathname.includes('/queues/stalled-upsells'))
    return RESOURCES.QUEUE_STALLED_UPSELLS;
  if (pathname.includes('/queues/upsell-hygiene'))
    return RESOURCES.QUEUE_UPSELL_HYGIENE;
  if (pathname.includes('/queues/ppl-sequence'))
    return RESOURCES.QUEUE_PPL_SEQUENCE;
  if (pathname.includes('/queues/at-risk'))
    return RESOURCES.QUEUE_AT_RISK;
  if (pathname.includes('/queues/cs-hygiene'))
    return RESOURCES.QUEUE_CS_HYGIENE;
  if (pathname.includes('/queues/pre-demo-pipeline'))
    return RESOURCES.QUEUE_PRE_DEMO_PIPELINE;
  if (pathname.includes('/queues/support-pulse'))
    return RESOURCES.QUEUE_SUPPORT_PULSE;
  if (pathname.includes('/queues/pitch-queue'))
    return RESOURCES.QUEUE_PITCH_QUEUE;
  if (pathname.includes('/queues/support-intel'))
    return RESOURCES.QUEUE_SUPPORT_INTEL;
  if (pathname.includes('/queues/follow-up-queue'))
    return RESOURCES.QUEUE_FOLLOW_UP;
  if (pathname.includes('/queues/deal-coach'))
    return RESOURCES.QUEUE_DEAL_COACH;
  if (pathname.includes('/queues/domain-enrichment'))
    return RESOURCES.QUEUE_DOMAIN_ENRICHMENT;
  if (pathname.includes('/queues/compliance-research'))
    return RESOURCES.QUEUE_COMPLIANCE_RESEARCH;
  if (pathname.includes('/queues/support-quality'))
    return RESOURCES.QUEUE_SUPPORT_QUALITY;
  if (pathname.includes('/queues/rcm-audit'))
    return RESOURCES.QUEUE_RCM_AUDIT;
  if (pathname.includes('/queues/support-manager'))
    return RESOURCES.QUEUE_SUPPORT_MANAGER;
  if (pathname.includes('/queues/deal-health'))
    return RESOURCES.QUEUE_DEAL_HEALTH;
  if (pathname.includes('/queues/pre-demo-coach'))
    return RESOURCES.QUEUE_PRE_DEMO_COACH;
  if (pathname.includes('/queues/support-trainer'))
    return RESOURCES.QUEUE_SUPPORT_TRAINER;
  if (pathname.includes('/queues/support-action-board'))
    return RESOURCES.QUEUE_SUPPORT_ACTION_BOARD;
  if (pathname.includes('/queues/deal-intelligence'))
    return RESOURCES.QUEUE_DEAL_HEALTH;

  // AE dashboard pages
  if (pathname.includes('/dashboard/home')) return RESOURCES.AE_HOME;
  if (pathname.includes('/dashboard/my-enrichment')) return RESOURCES.QUEUE_ENRICHMENT_VIEW;
  if (pathname.includes('/dashboard/my-compliance')) return RESOURCES.QUEUE_ENRICHMENT_VIEW;

  // PPL Dashboard
  if (pathname.includes('/dashboard/ppl')) return RESOURCES.PPL_DASHBOARD;

  // Morning Briefing
  if (pathname.includes('/dashboard/briefing')) return RESOURCES.MORNING_BRIEFING;

  // Hot Tracker
  if (pathname.includes('/dashboard/hot-tracker')) return RESOURCES.HOT_TRACKER;

  // Demo Tracker
  if (pathname.includes('/dashboard/demo-tracker')) return RESOURCES.DEMO_TRACKER;

  // AE pages
  if (pathname.match(/\/dashboard\/ae\/[^/]+/)) return RESOURCES.AE_DETAIL;

  // Dashboard
  if (pathname === '/dashboard' || pathname === '/dashboard/')
    return RESOURCES.DASHBOARD;

  // AE read-only API routes
  if (pathname.includes('/api/my-enrichment')) return RESOURCES.QUEUE_ENRICHMENT_VIEW;
  if (pathname.includes('/api/my-compliance')) return RESOURCES.QUEUE_ENRICHMENT_VIEW;

  // API routes
  if (pathname.includes('/api/portal')) return RESOURCES.PORTAL;
  if (pathname.includes('/api/agent')) return RESOURCES.API_AGENT;
  if (pathname.includes('/api/queues/hygiene')) return RESOURCES.QUEUE_HYGIENE;
  if (pathname.includes('/api/queues/next-step'))
    return RESOURCES.QUEUE_NEXT_STEP;
  if (pathname.includes('/api/queues/overdue-tasks'))
    return RESOURCES.QUEUE_OVERDUE_TASKS;
  if (pathname.includes('/api/queues/stalled-deals'))
    return RESOURCES.QUEUE_STALLED_DEALS;
  if (pathname.includes('/api/queues/stalled-upsells'))
    return RESOURCES.QUEUE_STALLED_UPSELLS;
  if (pathname.includes('/api/queues/upsell-hygiene'))
    return RESOURCES.QUEUE_UPSELL_HYGIENE;
  if (pathname.includes('/api/queues/ppl-sequence'))
    return RESOURCES.QUEUE_PPL_SEQUENCE;
  if (pathname.includes('/api/queues/at-risk'))
    return RESOURCES.QUEUE_AT_RISK;
  if (pathname.includes('/api/queues/cs-hygiene'))
    return RESOURCES.QUEUE_CS_HYGIENE;
  if (pathname.includes('/api/queues/pre-demo-pipeline'))
    return RESOURCES.QUEUE_PRE_DEMO_PIPELINE;
  if (pathname.includes('/api/queues/support-pulse'))
    return RESOURCES.QUEUE_SUPPORT_PULSE;
  if (pathname.includes('/api/queues/pitch-queue'))
    return RESOURCES.QUEUE_PITCH_QUEUE;
  if (pathname.includes('/api/queues/support-intel'))
    return RESOURCES.QUEUE_SUPPORT_INTEL;
  if (pathname.includes('/api/queues/follow-up-queue'))
    return RESOURCES.QUEUE_FOLLOW_UP;
  if (pathname.includes('/api/queues/deal-coach'))
    return RESOURCES.QUEUE_DEAL_COACH;
  if (pathname.includes('/api/queues/domain-enrichment'))
    return RESOURCES.QUEUE_DOMAIN_ENRICHMENT;
  if (pathname.includes('/api/queues/compliance-research'))
    return RESOURCES.QUEUE_COMPLIANCE_RESEARCH;
  if (pathname.includes('/api/queues/support-quality'))
    return RESOURCES.QUEUE_SUPPORT_QUALITY;
  if (pathname.includes('/api/queues/rcm-audit'))
    return RESOURCES.QUEUE_RCM_AUDIT;
  if (pathname.includes('/api/queues/support-manager'))
    return RESOURCES.QUEUE_SUPPORT_MANAGER;
  if (pathname.includes('/api/queues/pre-demo-coach'))
    return RESOURCES.QUEUE_PRE_DEMO_COACH;
  if (pathname.includes('/api/queues/support-trainer'))
    return RESOURCES.QUEUE_SUPPORT_TRAINER;
  if (pathname.includes('/api/queues/support-action-board'))
    return RESOURCES.QUEUE_SUPPORT_ACTION_BOARD;
  if (pathname.includes('/api/queues/deal-intelligence'))
    return RESOURCES.QUEUE_DEAL_HEALTH;
  if (pathname.includes('/api/queues/create-cs-task'))
    return RESOURCES.QUEUE_CS_HYGIENE;
  if (pathname.includes('/api/strategic-directives'))
    return RESOURCES.STRATEGIC_DIRECTIVES;
  if (pathname.includes('/api/ppl')) return RESOURCES.PPL_DASHBOARD;
  if (pathname.includes('/api/briefing')) return RESOURCES.MORNING_BRIEFING;
  if (pathname.includes('/api/hot-tracker')) return RESOURCES.HOT_TRACKER;
  if (pathname.includes('/api/demo-tracker')) return RESOURCES.DEMO_TRACKER;
  if (pathname.match(/\/api\/ae\/[^/]+/)) return RESOURCES.AE_DETAIL;

  return null;
}

/**
 * Get the user's default landing page based on their permissions
 */
export function getDefaultLandingPage(user: UserWithPermissions): string {
  // VP of RevOps goes to main dashboard
  if (user.role === 'vp_revops') {
    return '/dashboard';
  }

  // Account Executives go to their dashboard home
  if (user.role === 'account_executive') {
    return '/dashboard/home';
  }

  // CS Manager goes to Support Manager Queue
  if (user.role === 'cs_manager') {
    return '/dashboard/queues/support-manager';
  }

  // Support Agent goes to Support Trainer Queue
  if (user.role === 'support_agent') {
    return '/dashboard/queues/support-trainer';
  }

  // CMO and CEO go to PPL Sequence Queue
  if (user.permissions.includes(RESOURCES.QUEUE_PPL_SEQUENCE)) {
    return '/dashboard/queues/ppl-sequence';
  }

  // Fallback - shouldn't happen with proper setup
  return '/dashboard';
}
