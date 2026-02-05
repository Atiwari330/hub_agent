export type UserRole = 'vp_revops' | 'cmo' | 'ceo';

export interface UserWithPermissions {
  id: string;
  email: string;
  displayName: string | null;
  role: UserRole;
  permissions: string[];
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
  API_AGENT: 'api:agent',
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

  // AE pages
  if (pathname.match(/\/dashboard\/ae\/[^/]+/)) return RESOURCES.AE_DETAIL;

  // Dashboard
  if (pathname === '/dashboard' || pathname === '/dashboard/')
    return RESOURCES.DASHBOARD;

  // API routes
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
  if (pathname.includes('/api/queues/create-cs-task'))
    return RESOURCES.QUEUE_CS_HYGIENE;
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

  // CMO and CEO go to PPL Sequence Queue
  if (user.permissions.includes(RESOURCES.QUEUE_PPL_SEQUENCE)) {
    return '/dashboard/queues/ppl-sequence';
  }

  // Fallback - shouldn't happen with proper setup
  return '/dashboard';
}
