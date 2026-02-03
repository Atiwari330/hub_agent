import { requirePermission, RESOURCES } from '@/lib/auth';
import { PplSequenceQueueView } from '@/components/dashboard/queues/ppl-sequence-queue-view';

export default async function PplSequenceQueuePage() {
  await requirePermission(RESOURCES.QUEUE_PPL_SEQUENCE);

  return (
    <div className="p-6">
      <PplSequenceQueueView />
    </div>
  );
}
