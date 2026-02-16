import { redirect } from 'next/navigation';
import { getCurrentUser, getDefaultLandingPage } from '@/lib/auth';

export default async function Home() {
  const user = await getCurrentUser();
  if (!user) {
    redirect('/login');
  }
  redirect(getDefaultLandingPage(user));
}
