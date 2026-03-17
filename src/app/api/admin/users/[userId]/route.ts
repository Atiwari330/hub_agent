import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/client';
import { checkApiAuth } from '@/lib/auth/api';

interface RouteParams {
  params: Promise<{ userId: string }>;
}

/**
 * PATCH /api/admin/users/[userId]
 * Update a user's password (VP only)
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const authResult = await checkApiAuth();
  if (authResult instanceof NextResponse) return authResult;
  if (authResult.role !== 'vp_revops') {
    return NextResponse.json({ error: 'VP only' }, { status: 403 });
  }

  try {
    const { userId } = await params;
    const { password } = await request.json();

    if (!password || password.length < 6) {
      return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 });
    }

    const serviceClient = createServiceClient();
    const { error } = await serviceClient.auth.admin.updateUserById(userId, { password });

    if (error) {
      return NextResponse.json({ error: 'Failed to update password', details: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Admin user PATCH error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/admin/users/[userId]
 * Delete a user (VP only). Cannot delete yourself.
 */
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const authResult = await checkApiAuth();
  if (authResult instanceof NextResponse) return authResult;
  if (authResult.role !== 'vp_revops') {
    return NextResponse.json({ error: 'VP only' }, { status: 403 });
  }

  try {
    const { userId } = await params;

    // Prevent self-deletion
    if (userId === authResult.id) {
      return NextResponse.json({ error: 'Cannot delete your own account' }, { status: 400 });
    }

    const serviceClient = createServiceClient();

    // Delete permissions and profile first (cascade should handle this, but be explicit)
    await serviceClient.from('user_permissions').delete().eq('user_id', userId);
    await serviceClient.from('user_profiles').delete().eq('id', userId);

    // Delete auth user
    const { error } = await serviceClient.auth.admin.deleteUser(userId);
    if (error) {
      return NextResponse.json({ error: 'Failed to delete user', details: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Admin user DELETE error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
