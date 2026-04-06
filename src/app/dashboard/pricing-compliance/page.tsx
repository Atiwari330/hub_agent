import { requirePermission, RESOURCES } from '@/lib/auth';
import { PricingComplianceDashboard } from '@/components/dashboard/pricing-compliance-dashboard';

export default async function PricingCompliancePage() {
  await requirePermission(RESOURCES.PRICING_COMPLIANCE);

  return <PricingComplianceDashboard />;
}
