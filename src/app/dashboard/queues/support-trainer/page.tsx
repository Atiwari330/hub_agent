import { Suspense } from 'react';
import { requirePermission, RESOURCES, hasPermission } from '@/lib/auth';
import { SupportTrainerView } from '@/components/dashboard/queues/support-trainer-view';

export default async function SupportTrainerPage() {
  const user = await requirePermission(RESOURCES.QUEUE_SUPPORT_TRAINER);

  return (
    <Suspense>
      <SupportTrainerView userRole={user.role} canAnalyzeTicket={hasPermission(user, RESOURCES.ANALYZE_TICKET)} />
    </Suspense>
  );
}
