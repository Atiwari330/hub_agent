import { redirect } from 'next/navigation';
import { requirePermission, RESOURCES } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/client';
import { fetchQ2Deals } from '@/lib/command-center/fetch-q2-deals';
import { DealReviewWorksheet } from '@/components/deal-review/deal-review-worksheet';

export default async function DealReviewPage() {
  const user = await requirePermission(RESOURCES.AE_DEAL_REVIEW);

  if (!user.hubspotOwnerId) {
    redirect('/unauthorized');
  }

  const supabase = createServiceClient();

  // Look up internal owner_id from hubspot_owner_id
  const { data: owner } = await supabase
    .from('owners')
    .select('id, first_name, last_name')
    .eq('hubspot_owner_id', user.hubspotOwnerId)
    .single();

  if (!owner) {
    redirect('/unauthorized');
  }

  const aeName = [owner.first_name, owner.last_name].filter(Boolean).join(' ') || user.displayName || user.email;

  // Fetch Q2 deals scoped to this AE
  const allDeals = await fetchQ2Deals(supabase);
  const myDeals = allDeals.filter((d) => d.ownerId === String(owner.id));

  return (
    <DealReviewWorksheet
      initialDeals={myDeals}
      aeName={aeName}
      logoutUrl="/api/auth/logout"
    />
  );
}
