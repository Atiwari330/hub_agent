import { requirePermission, RESOURCES } from '@/lib/auth';
import { NextStepQueueView } from '@/components/dashboard/queues/next-step-queue-view';

export default async function NextStepQueuePage() {
  await requirePermission(RESOURCES.QUEUE_NEXT_STEP);

  return (
    <div className="p-6">
      <NextStepQueueView />
    </div>
  );
}
