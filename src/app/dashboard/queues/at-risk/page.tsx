import { requirePermission, RESOURCES } from '@/lib/auth';
import { AtRiskQueueView } from '@/components/dashboard/queues/at-risk-queue-view';

export default async function AtRiskQueuePage() {
  await requirePermission(RESOURCES.QUEUE_AT_RISK);

  return <AtRiskQueueView />;
}
