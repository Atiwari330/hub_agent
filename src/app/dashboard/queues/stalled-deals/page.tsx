import { redirect } from 'next/navigation';

export default function StalledDealsQueuePage() {
  redirect('/dashboard/queues/deal-health');
}
