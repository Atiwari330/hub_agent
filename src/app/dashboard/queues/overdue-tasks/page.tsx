import { redirect } from 'next/navigation';

export default function OverdueTasksQueuePage() {
  redirect('/dashboard/queues/deal-health');
}
