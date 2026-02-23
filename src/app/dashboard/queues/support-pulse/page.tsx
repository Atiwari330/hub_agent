import { requirePermission, RESOURCES } from '@/lib/auth';
import { SupportPulseView } from '@/components/dashboard/queues/support-pulse-view';

export default async function SupportPulsePage() {
  await requirePermission(RESOURCES.QUEUE_SUPPORT_PULSE);

  return <SupportPulseView />;
}
