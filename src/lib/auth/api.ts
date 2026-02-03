import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/client';
import type { Resource, UserWithPermissions } from './index';

/**
 * Check API route authorization
 * Returns the user if authorized, or a NextResponse if unauthorized
 * Use at the start of API route handlers:
 *
 * const authResult = await checkApiAuth(RESOURCES.QUEUE_HYGIENE);
 * if (authResult instanceof NextResponse) return authResult;
 * const user = authResult;
 */
export async function checkApiAuth(
  resource?: Resource
): Promise<UserWithPermissions | NextResponse> {
  const supabase = await createServerSupabaseClient();

  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Fetch user profile and permissions
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('id', authUser.id)
    .single();

  if (!profile) {
    return NextResponse.json({ error: 'User not found' }, { status: 401 });
  }

  const { data: permissions } = await supabase
    .from('user_permissions')
    .select('resource')
    .eq('user_id', authUser.id);

  const user: UserWithPermissions = {
    id: authUser.id,
    email: profile.email,
    displayName: profile.display_name,
    role: profile.role,
    permissions: permissions?.map((p) => p.resource) || [],
  };

  // Check permission if resource is specified
  if (resource !== undefined) {
    // VP of RevOps has access to everything
    if (user.role !== 'vp_revops' && !user.permissions.includes(resource)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  return user;
}
