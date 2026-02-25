import { requirePermission, RESOURCES } from '@/lib/auth';
import { PitchQueueView } from '@/components/dashboard/queues/pitch-queue-view';

export default async function PitchQueuePage() {
  await requirePermission(RESOURCES.QUEUE_PITCH_QUEUE);

  return <PitchQueueView />;
}
