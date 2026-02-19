import { requirePermission, RESOURCES } from '@/lib/auth';
import { HotTrackerView } from '@/components/dashboard/hot-tracker-view';

export default async function HotTrackerPage() {
  await requirePermission(RESOURCES.HOT_TRACKER);

  return <HotTrackerView />;
}
