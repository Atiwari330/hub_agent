import { requirePermission, RESOURCES } from '@/lib/auth';
import { StalledUpsellsQueueView } from '@/components/dashboard/queues/stalled-upsells-queue-view';

export default async function StalledUpsellsQueuePage() {
  await requirePermission(RESOURCES.QUEUE_STALLED_UPSELLS);

  return <StalledUpsellsQueueView />;
}
