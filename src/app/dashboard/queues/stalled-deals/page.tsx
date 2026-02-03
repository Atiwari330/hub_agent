import { requirePermission, RESOURCES } from '@/lib/auth';
import { StalledDealsQueueView } from '@/components/dashboard/queues/stalled-deals-queue-view';

export default async function StalledDealsQueuePage() {
  await requirePermission(RESOURCES.QUEUE_STALLED_DEALS);

  return (
    <div className="p-6">
      <StalledDealsQueueView />
    </div>
  );
}
