import { requirePermission, RESOURCES } from '@/lib/auth';
import { DemoEconomicsView } from '@/components/dashboard/demo-economics-view';

export default async function DemoEconomicsPage() {
  await requirePermission(RESOURCES.DEMO_TRACKER);
  return <DemoEconomicsView />;
}
