import { requirePermission, RESOURCES } from '@/lib/auth';
import { PreDemoCoachView } from '@/components/dashboard/queues/pre-demo-coach-view';

export default async function PreDemoCoachPage() {
  await requirePermission(RESOURCES.QUEUE_PRE_DEMO_COACH);

  return <PreDemoCoachView />;
}
