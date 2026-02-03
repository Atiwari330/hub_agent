import { requirePermission, RESOURCES } from '@/lib/auth';
import { MissionControlClient } from '@/components/dashboard/mission-control-client';

export default async function DashboardPage() {
  await requirePermission(RESOURCES.DASHBOARD);

  return <MissionControlClient />;
}
