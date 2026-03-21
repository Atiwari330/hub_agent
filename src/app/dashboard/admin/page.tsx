import { requireAuth } from '@/lib/auth';
import { AdminUsersView } from '@/components/dashboard/admin-users-view';
import { AdminAnalysisUsage } from '@/components/dashboard/admin-analysis-usage';

export default async function AdminPage() {
  const user = await requireAuth();

  // VP-only page
  if (user.role !== 'vp_revops') {
    const { redirect } = await import('next/navigation');
    redirect('/unauthorized');
  }

  return (
    <div className="space-y-6">
      <AdminUsersView />
      <AdminAnalysisUsage />
    </div>
  );
}
