import { requirePermission, RESOURCES } from '@/lib/auth';
import { Q2GoalTrackerView } from '@/components/dashboard/q2-goal-tracker-view';

export default async function Q2GoalTrackerPage() {
  await requirePermission(RESOURCES.Q2_GOAL_TRACKER);
  return <Q2GoalTrackerView />;
}
