import { requirePermission, RESOURCES } from '@/lib/auth';
import { CSHygieneQueueView } from '@/components/dashboard/queues/cs-hygiene-queue-view';

export default async function CSHygieneQueuePage() {
  await requirePermission(RESOURCES.QUEUE_CS_HYGIENE);

  return <CSHygieneQueueView />;
}
