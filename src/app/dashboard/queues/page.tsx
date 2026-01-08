import { redirect } from 'next/navigation';

export default function QueuesPage() {
  // Redirect to hygiene queue by default
  redirect('/dashboard/queues/hygiene');
}
