import { requirePermission, RESOURCES } from '@/lib/auth';
import { OverdueTasksQueueView } from '@/components/dashboard/queues/overdue-tasks-queue-view';

export default async function OverdueTasksQueuePage() {
  await requirePermission(RESOURCES.QUEUE_OVERDUE_TASKS);

  return <OverdueTasksQueueView />;
}
