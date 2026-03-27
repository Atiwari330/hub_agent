import { requirePermission, RESOURCES } from '@/lib/auth';
import { PplDashboard } from '@/components/dashboard/ppl-dashboard';

export default async function PplDashboardPage() {
  await requirePermission(RESOURCES.PPL_DASHBOARD);

  return <PplDashboard />;
}
