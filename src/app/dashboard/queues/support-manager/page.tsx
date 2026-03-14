import { requirePermission, RESOURCES } from '@/lib/auth';
import { SupportManagerView } from '@/components/dashboard/queues/support-manager-view';

export default async function SupportManagerPage() {
  await requirePermission(RESOURCES.QUEUE_SUPPORT_MANAGER);

  return <SupportManagerView />;
}
