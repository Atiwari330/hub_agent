import { requirePermission, RESOURCES } from '@/lib/auth';
import { BriefingView } from '@/components/dashboard/briefing/briefing-view';

export default async function BriefingPage() {
  await requirePermission(RESOURCES.MORNING_BRIEFING);

  return <BriefingView />;
}
