import { requirePermission, RESOURCES } from '@/lib/auth';
import { DealHealthView } from '@/components/dashboard/queues/deal-health-view';

export default async function DealHealthPage() {
  await requirePermission(RESOURCES.QUEUE_DEAL_HEALTH);

  return <DealHealthView />;
}
