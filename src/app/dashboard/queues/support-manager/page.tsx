import { requirePermission, RESOURCES, hasPermission } from '@/lib/auth';
import { SupportManagerView } from '@/components/dashboard/queues/support-manager-view';

export default async function SupportManagerPage() {
  const user = await requirePermission(RESOURCES.QUEUE_SUPPORT_MANAGER);

  return <SupportManagerView userRole={user.role} canAnalyzeTicket={hasPermission(user, RESOURCES.ANALYZE_TICKET)} />;
}
