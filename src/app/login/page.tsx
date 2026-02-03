import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { createServerSupabaseClient } from '@/lib/supabase/client';
import { LoginForm } from '@/components/auth/login-form';

export default async function LoginPage() {
  // If already authenticated, redirect to dashboard
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect('/dashboard');
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div>
          <h1 className="text-center text-3xl font-bold text-gray-900">
            RevOps Agent
          </h1>
          <h2 className="mt-2 text-center text-lg text-gray-600">
            EHR Sales Intelligence
          </h2>
          <p className="mt-6 text-center text-sm text-gray-500">
            Sign in to access your dashboard
          </p>
        </div>

        <Suspense
          fallback={
            <div className="text-center text-gray-500">Loading...</div>
          }
        >
          <LoginForm />
        </Suspense>
      </div>
    </div>
  );
}
