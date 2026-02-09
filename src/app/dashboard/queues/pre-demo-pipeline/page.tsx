import { requirePermission, RESOURCES } from '@/lib/auth';
import { PreDemoPipelineQueueView } from '@/components/dashboard/queues/pre-demo-pipeline-queue-view';

export default async function PreDemoPipelineQueuePage() {
  await requirePermission(RESOURCES.QUEUE_PRE_DEMO_PIPELINE);

  return (
    <div className="p-6">
      <PreDemoPipelineQueueView />
    </div>
  );
}
