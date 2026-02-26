import { requirePermission, RESOURCES } from '@/lib/auth';
import { FollowUpQueueView } from '@/components/dashboard/queues/follow-up-queue-view';

export default async function FollowUpQueuePage() {
  await requirePermission(RESOURCES.QUEUE_FOLLOW_UP);

  return <FollowUpQueueView />;
}
