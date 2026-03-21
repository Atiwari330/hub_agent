import { requirePermission, RESOURCES } from '@/lib/auth';
import { ComplianceResearchView } from '@/components/dashboard/queues/compliance-research-view';

export default async function MyCompliancePage() {
  await requirePermission(RESOURCES.QUEUE_ENRICHMENT_VIEW);
  return <ComplianceResearchView readOnly apiBasePath="/api/my-compliance" />;
}
