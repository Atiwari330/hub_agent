import { requirePermission, RESOURCES } from '@/lib/auth';
import { RcmAuditView } from '@/components/dashboard/queues/rcm-audit-view';

export default async function RcmAuditPage() {
  await requirePermission(RESOURCES.QUEUE_RCM_AUDIT);

  return <RcmAuditView />;
}
