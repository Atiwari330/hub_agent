import { requirePermission, RESOURCES } from '@/lib/auth';
import { HygieneQueueView } from '@/components/dashboard/queues/hygiene-queue-view';

export default async function HygieneQueuePage() {
  await requirePermission(RESOURCES.QUEUE_HYGIENE);

  return <HygieneQueueView />;
}
