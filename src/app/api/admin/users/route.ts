import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/client';
import { checkApiAuth } from '@/lib/auth/api';

// Default permissions by role
const DEFAULT_PERMISSIONS: Record<string, string[]> = {
  vp_revops: [],
  cs_manager: ['queue:support-manager', 'queue:support-trainer', 'queue:support-action-board', 'analyze:ticket'],
  support_agent: ['queue:support-trainer', 'queue:support-action-board'],
  account_executive: ['portal'],
  cmo: ['queue:ppl-sequence', 'hot_tracker'],
  ceo: ['queue:ppl-sequence', 'hot_tracker'],
};

/**
 * GET /api/admin/users
 * List all users with their profiles, permissions, and auth metadata (VP only)
 */
export async function GET() {
  const authResult = await checkApiAuth();
  if (authResult instanceof NextResponse) return authResult;
  if (authResult.role !== 'vp_revops') {
    return NextResponse.json({ error: 'VP only' }, { status: 403 });
  }

  try {
    const serviceClient = createServiceClient();

    // Fetch auth users for last_sign_in_at
    const { data: authData, error: authError } = await serviceClient.auth.admin.listUsers();
    if (authError) {
      return NextResponse.json({ error: 'Failed to list auth users', details: authError.message }, { status: 500 });
    }

    const authUsers = authData?.users || [];
    const authMap: Record<string, { lastSignIn: string | null; createdAt: string }> = {};
    for (const u of authUsers) {
      authMap[u.id] = {
        lastSignIn: u.last_sign_in_at || null,
        createdAt: u.created_at,
      };
    }

    // Fetch profiles
    const { data: profiles, error: profileError } = await serviceClient
      .from('user_profiles')
      .select('id, email, display_name, role')
      .order('email');

    if (profileError) {
      return NextResponse.json({ error: 'Failed to fetch profiles', details: profileError.message }, { status: 500 });
    }

    // Fetch all permissions
    const { data: allPerms } = await serviceClient
      .from('user_permissions')
      .select('user_id, resource');

    const permsByUser: Record<string, string[]> = {};
    for (const p of allPerms || []) {
      if (!permsByUser[p.user_id]) permsByUser[p.user_id] = [];
      permsByUser[p.user_id].push(p.resource);
    }

    // Merge
    const users = (profiles || []).map((p) => ({
      id: p.id,
      email: p.email,
      displayName: p.display_name,
      role: p.role,
      permissions: permsByUser[p.id] || [],
      lastSignIn: authMap[p.id]?.lastSignIn || null,
      createdAt: authMap[p.id]?.createdAt || null,
    }));

    // Also fetch recent workflow runs for the activity log
    const { data: workflowRuns } = await serviceClient
      .from('workflow_runs')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(20);

    return NextResponse.json({ users, workflowRuns: workflowRuns || [] });
  } catch (error) {
    console.error('Admin users GET error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/users
 * Create a new user (VP only)
 */
export async function POST(request: NextRequest) {
  const authResult = await checkApiAuth();
  if (authResult instanceof NextResponse) return authResult;
  if (authResult.role !== 'vp_revops') {
    return NextResponse.json({ error: 'VP only' }, { status: 403 });
  }

  try {
    const { email, displayName, role, password } = await request.json();

    if (!email || !role || !password) {
      return NextResponse.json({ error: 'email, role, and password are required' }, { status: 400 });
    }

    if (password.length < 6) {
      return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 });
    }

    const validRoles = ['vp_revops', 'cs_manager', 'support_agent', 'account_executive', 'cmo', 'ceo'];
    if (!validRoles.includes(role)) {
      return NextResponse.json({ error: `Invalid role. Must be one of: ${validRoles.join(', ')}` }, { status: 400 });
    }

    const serviceClient = createServiceClient();

    // Create auth user
    const { data: authData, error: authError } = await serviceClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (authError) {
      return NextResponse.json({ error: 'Failed to create user', details: authError.message }, { status: 500 });
    }

    const userId = authData.user.id;

    // Create profile
    const { error: profileError } = await serviceClient.from('user_profiles').insert({
      id: userId,
      email,
      display_name: displayName || email.split('@')[0],
      role,
    });

    if (profileError) {
      // Clean up auth user if profile creation fails
      await serviceClient.auth.admin.deleteUser(userId);
      return NextResponse.json({ error: 'Failed to create profile', details: profileError.message }, { status: 500 });
    }

    // Grant default permissions
    const permissions = DEFAULT_PERMISSIONS[role] || [];
    if (permissions.length > 0) {
      const { error: permError } = await serviceClient.from('user_permissions').insert(
        permissions.map((resource) => ({ user_id: userId, resource }))
      );
      if (permError) {
        console.error('Failed to grant permissions:', permError);
      }
    }

    return NextResponse.json({
      user: {
        id: userId,
        email,
        displayName: displayName || email.split('@')[0],
        role,
        permissions,
        lastSignIn: null,
        createdAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('Admin users POST error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
