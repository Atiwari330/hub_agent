import { requirePermission, RESOURCES } from '@/lib/auth';
import { SupportIntelView } from '@/components/dashboard/queues/support-intel-view';

export default async function SupportIntelPage() {
  await requirePermission(RESOURCES.QUEUE_SUPPORT_INTEL);

  return <SupportIntelView />;
}
