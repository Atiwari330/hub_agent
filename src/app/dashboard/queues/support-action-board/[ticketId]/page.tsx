import { requirePermission, RESOURCES, hasPermission } from '@/lib/auth';
import { TicketDetailView } from '@/components/dashboard/queues/action-board/ticket-detail-view';

export default async function TicketDetailPage({
  params,
}: {
  params: Promise<{ ticketId: string }>;
}) {
  const user = await requirePermission(RESOURCES.QUEUE_SUPPORT_ACTION_BOARD);
  const { ticketId } = await params;

  return (
    <TicketDetailView
      ticketId={ticketId}
      userRole={user.role}
      canAnalyzeTicket={hasPermission(user, RESOURCES.ANALYZE_TICKET)}
    />
  );
}
