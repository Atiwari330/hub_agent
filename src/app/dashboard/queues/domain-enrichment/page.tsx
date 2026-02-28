import { requirePermission, RESOURCES } from '@/lib/auth';
import { DomainEnrichmentView } from '@/components/dashboard/queues/domain-enrichment-view';

export default async function DomainEnrichmentPage() {
  await requirePermission(RESOURCES.QUEUE_DOMAIN_ENRICHMENT);

  return <DomainEnrichmentView />;
}
