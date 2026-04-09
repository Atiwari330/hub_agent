import { requirePermission, RESOURCES } from '@/lib/auth';
import { CommandCenterView } from '@/components/command-center/command-center-view';

export default async function Q2CommandCenterPage() {
  await requirePermission(RESOURCES.Q2_COMMAND_CENTER);
  return <CommandCenterView />;
}
