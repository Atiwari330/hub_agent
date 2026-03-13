import { requirePermission, RESOURCES } from '@/lib/auth';
import { DemoTrackerView } from '@/components/dashboard/demo-tracker-view';

export default async function DemoTrackerPage() {
  await requirePermission(RESOURCES.DEMO_TRACKER);

  return <DemoTrackerView />;
}
