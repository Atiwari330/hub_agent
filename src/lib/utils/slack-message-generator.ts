import { formatCurrency } from '@/lib/utils/currency';

interface DealForMessage {
  dealName: string;
  amount: number | null;
  missingFields: { label: string }[];
}

interface HygieneQueueDeal {
  id: string;
  dealName: string;
  amount: number | null;
  ownerName: string;
  ownerId: string;
  missingFields: { field: string; label: string }[];
}

interface GroupedDeals {
  ownerName: string;
  deals: DealForMessage[];
}

/**
 * Generate a Slack message for an AE about their deals needing hygiene updates
 */
export function generateSlackMessage(ownerName: string, deals: DealForMessage[]): string {
  const firstName = ownerName.split(' ')[0];
  const isSingle = deals.length === 1;

  const dealLines = deals
    .map((deal) => {
      const amountStr = deal.amount ? formatCurrency(deal.amount) : 'No amount';
      const missingStr = deal.missingFields.map((f) => f.label).join(', ');
      return `• ${deal.dealName} (${amountStr}) — Missing: ${missingStr}`;
    })
    .join('\n');

  const intro = isSingle
    ? 'Quick hygiene check on this new deal:'
    : 'Quick hygiene check on these new deals:';

  const outro = isSingle
    ? 'When can you get this completed?'
    : 'When do you think you can get these filled out? Just need a date to track against.';

  return `@${firstName}
${intro}

${dealLines}

${outro}`;
}

/**
 * Group deals by owner for message generation
 */
export function groupDealsByOwner(
  deals: HygieneQueueDeal[]
): Map<string, GroupedDeals> {
  const grouped = new Map<string, GroupedDeals>();

  for (const deal of deals) {
    const existing = grouped.get(deal.ownerId);

    const dealForMessage: DealForMessage = {
      dealName: deal.dealName,
      amount: deal.amount,
      missingFields: deal.missingFields,
    };

    if (existing) {
      existing.deals.push(dealForMessage);
    } else {
      grouped.set(deal.ownerId, {
        ownerName: deal.ownerName,
        deals: [dealForMessage],
      });
    }
  }

  return grouped;
}

/**
 * Generate all Slack messages for multiple owners
 */
export function generateAllSlackMessages(
  deals: HygieneQueueDeal[]
): { ownerId: string; ownerName: string; message: string }[] {
  const grouped = groupDealsByOwner(deals);
  const messages: { ownerId: string; ownerName: string; message: string }[] = [];

  for (const [ownerId, group] of grouped) {
    messages.push({
      ownerId,
      ownerName: group.ownerName,
      message: generateSlackMessage(group.ownerName, group.deals),
    });
  }

  // Sort by owner name for consistent display
  messages.sort((a, b) => a.ownerName.localeCompare(b.ownerName));

  return messages;
}
