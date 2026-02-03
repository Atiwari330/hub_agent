import { requirePermission, RESOURCES } from '@/lib/auth';
import { UpsellHygieneQueueView } from '@/components/dashboard/queues/upsell-hygiene-queue-view';

export default async function UpsellHygieneQueuePage() {
  await requirePermission(RESOURCES.QUEUE_UPSELL_HYGIENE);

  return <UpsellHygieneQueueView />;
}
