import { requirePermission, RESOURCES } from '@/lib/auth';
import { ComplianceResearchView } from '@/components/dashboard/queues/compliance-research-view';

export default async function ComplianceResearchPage() {
  await requirePermission(RESOURCES.QUEUE_COMPLIANCE_RESEARCH);

  return <ComplianceResearchView />;
}
