import { requirePermission, RESOURCES, hasPermission } from '@/lib/auth';
import { SupportActionBoardView } from '@/components/dashboard/queues/support-action-board-view';

export default async function SupportActionBoardPage() {
  const user = await requirePermission(RESOURCES.QUEUE_SUPPORT_ACTION_BOARD);

  return <SupportActionBoardView userRole={user.role} canAnalyzeTicket={hasPermission(user, RESOURCES.ANALYZE_TICKET)} />;
}
