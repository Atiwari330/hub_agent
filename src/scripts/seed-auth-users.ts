import { config } from 'dotenv';
config({ path: '.env.local' });

/**
 * Seed script to create auth users and their permissions
 *
 * Run with: npx tsx src/scripts/seed-auth-users.ts
 *
 * This script creates users:
 * - VP of RevOps (full access)
 * - CMO (PPL Sequence only)
 * - CEO (PPL Sequence only)
 * - 3 Account Executives (portal only, linked to HubSpot owner)
 *
 * NOTE: You can also create users manually in the Supabase Dashboard:
 * Authentication > Users > Add user
 */

import { createClient } from '@supabase/supabase-js';
import * as readline from 'readline';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

// User definitions
const USERS = [
  {
    email: 'atiwari@opusbehavioral.com',
    displayName: 'Adi Tiwari',
    role: 'vp_revops',
    // VP of RevOps gets full access (role-based, no explicit permissions needed)
    permissions: [] as string[],
  },
  {
    email: 'eric@opusbehavioral.com',
    displayName: 'Eric Brandman',
    role: 'cmo',
    permissions: ['queue:ppl-sequence'],
  },
  {
    email: 'hbuniotto@opusbehavioral.com',
    displayName: 'Humberto Buniotto',
    role: 'ceo',
    permissions: ['queue:ppl-sequence'],
  },
  {
    email: 'aboyd@opusbehavioral.com',
    displayName: 'Amos Boyd',
    role: 'account_executive',
    permissions: ['portal'],
  },
  {
    email: 'cgarraffa@opusbehavioral.com',
    displayName: 'Chris Garraffa',
    role: 'account_executive',
    permissions: ['portal'],
  },
  {
    email: 'jrice@opusbehavioral.com',
    displayName: 'Jack Rice',
    role: 'account_executive',
    permissions: ['portal'],
  },
];

async function promptForPassword(email: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(`Enter password for ${email}: `, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function createUser(
  email: string,
  password: string,
  displayName: string,
  role: string,
  permissions: string[]
) {
  console.log(`\nCreating user: ${email}`);

  // Check if user already exists
  const { data: existingUsers } = await supabase.auth.admin.listUsers();
  const existingUser = existingUsers?.users?.find((u) => u.email === email);

  let userId: string;

  if (existingUser) {
    console.log(`  User already exists, updating...`);
    userId = existingUser.id;

    // Update password
    const { error: updateError } = await supabase.auth.admin.updateUserById(
      userId,
      { password }
    );
    if (updateError) {
      console.error(`  Failed to update password: ${updateError.message}`);
    }
  } else {
    // Create new user
    const { data: authData, error: authError } =
      await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });

    if (authError) {
      console.error(`  Failed to create auth user: ${authError.message}`);
      return;
    }

    userId = authData.user.id;
    console.log(`  Auth user created: ${userId}`);
  }

  // Upsert user profile
  const { error: profileError } = await supabase.from('user_profiles').upsert(
    {
      id: userId,
      email,
      display_name: displayName,
      role,
    },
    { onConflict: 'id' }
  );

  if (profileError) {
    console.error(`  Failed to create profile: ${profileError.message}`);
    return;
  }
  console.log(`  Profile created/updated`);

  // Delete existing permissions and add new ones
  await supabase.from('user_permissions').delete().eq('user_id', userId);

  if (permissions.length > 0) {
    const permissionRows = permissions.map((resource) => ({
      user_id: userId,
      resource,
    }));

    const { error: permError } = await supabase
      .from('user_permissions')
      .insert(permissionRows);

    if (permError) {
      console.error(`  Failed to create permissions: ${permError.message}`);
      return;
    }
    console.log(`  Permissions granted: ${permissions.join(', ')}`);
  } else {
    console.log(`  No explicit permissions (role-based access)`);
  }

  // For AEs, link their hubspot_owner_id from the owners table
  if (role === 'account_executive') {
    const { data: owner } = await supabase
      .from('owners')
      .select('hubspot_owner_id')
      .eq('email', email)
      .single();

    if (owner?.hubspot_owner_id) {
      const { error: linkError } = await supabase
        .from('user_profiles')
        .update({ hubspot_owner_id: owner.hubspot_owner_id })
        .eq('id', userId);

      if (linkError) {
        console.error(`  Failed to link HubSpot owner: ${linkError.message}`);
      } else {
        console.log(`  Linked to HubSpot owner: ${owner.hubspot_owner_id}`);
      }
    } else {
      console.warn(`  Warning: No HubSpot owner found for ${email}`);
    }
  }

  console.log(`  Done!`);
}

async function main() {
  console.log('=== Auth User Seeding Script ===\n');
  console.log('This will create/update users in Supabase Auth.\n');

  // Get a single password to use for all users (for simplicity in dev)
  const defaultPassword = await promptForPassword('all users (or press Enter for individual)');

  for (const user of USERS) {
    const password = defaultPassword || await promptForPassword(user.email);

    if (!password || password.length < 6) {
      console.log(`Skipping ${user.email} - password too short (min 6 chars)`);
      continue;
    }

    await createUser(
      user.email,
      password,
      user.displayName,
      user.role,
      user.permissions
    );
  }

  console.log('\n=== Seeding Complete ===');
  console.log('\nUsers can now login at /login with their email and password.');
  console.log('\nPermissions summary:');
  console.log('- VP of RevOps (atiwari@): Full access to everything');
  console.log('- CMO (eric@): PPL Sequence Queue only');
  console.log('- CEO (hbuniotto@): PPL Sequence Queue only');
  console.log('- AE (aboyd@): Portal only');
  console.log('- AE (cgarraffa@): Portal only');
  console.log('- AE (jrice@): Portal only');
}

main().catch(console.error);
