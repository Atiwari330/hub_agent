// Server-side auth functions
// IMPORTANT: Do not import this file in client components
// For client components, import from '@/lib/auth/types' instead

import { redirect } from 'next/navigation';
import { createServerSupabaseClient } from '@/lib/supabase/client';
import type { UserWithPermissions, Resource } from './types';
import { hasPermission } from './types';

// Re-export types and client-safe functions
export * from './types';

/**
 * Get the currently authenticated user with their permissions
 * Returns null if not authenticated
 */
export async function getCurrentUser(): Promise<UserWithPermissions | null> {
  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  // Fetch user profile and permissions
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('id', user.id)
    .single();

  if (!profile) {
    return null;
  }

  const { data: permissions } = await supabase
    .from('user_permissions')
    .select('resource')
    .eq('user_id', user.id);

  return {
    id: user.id,
    email: profile.email,
    displayName: profile.display_name,
    role: profile.role,
    permissions: permissions?.map((p) => p.resource) || [],
  };
}

/**
 * Require authentication - redirects to login if not authenticated
 * Use in server components at the top of the component
 */
export async function requireAuth(): Promise<UserWithPermissions> {
  const user = await getCurrentUser();

  if (!user) {
    redirect('/login');
  }

  return user;
}

/**
 * Require permission for a specific resource - redirects appropriately
 * Use in server components at the top of the component
 */
export async function requirePermission(
  resource: Resource
): Promise<UserWithPermissions> {
  const user = await requireAuth();

  if (!hasPermission(user, resource)) {
    redirect('/unauthorized');
  }

  return user;
}
