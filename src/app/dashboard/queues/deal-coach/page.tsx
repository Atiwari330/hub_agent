import { requirePermission, RESOURCES } from '@/lib/auth';
import { DealCoachView } from '@/components/dashboard/queues/deal-coach-view';

export default async function DealCoachPage() {
  await requirePermission(RESOURCES.QUEUE_DEAL_COACH);

  return <DealCoachView />;
}
