import { requirePermission, RESOURCES } from '@/lib/auth';
import { DomainEnrichmentView } from '@/components/dashboard/queues/domain-enrichment-view';

export default async function MyEnrichmentPage() {
  await requirePermission(RESOURCES.QUEUE_ENRICHMENT_VIEW);
  return <DomainEnrichmentView readOnly apiBasePath="/api/my-enrichment" />;
}
