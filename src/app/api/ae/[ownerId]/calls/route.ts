import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/client';
import { fetchCallsByOwner, fetchCallAssociations, getHubSpotCallUrl } from '@/lib/hubspot/calls';
import { getCurrentQuarter, getQuarterInfo } from '@/lib/utils/quarter';
import { isConnectedOutcome, formatCallDuration, getOutcomeKey, getOutcomeLabel } from '@/lib/utils/call-outcomes';
import type { CallPeriod, CallActivityResponse, CallDrillDownResponse, OutcomeBreakdown, DailyTrendPoint, CallWithAssociations, CallData } from '@/types/calls';

// Map outcome keys to display labels for drill-down filter
const OUTCOME_KEY_LABELS: Record<string, string> = {
  connected: 'Connected',
  leftVoicemail: 'Left Voicemail',
  leftLiveMessage: 'Left Live Message',
  noAnswer: 'No Answer',
  wrongNumber: 'Wrong Number',
  busy: 'Busy',
  unknown: 'Unknown',
};

interface RouteParams {
  params: Promise<{ ownerId: string }>;
}

// Format date as YYYY-MM-DD
function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

// Get date range for a period
function getDateRange(period: CallPeriod, year?: number, quarter?: number, customDate?: string): { startDate: Date; endDate: Date; label: string } {
  const now = new Date();

  switch (period) {
    case 'today': {
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      const end = new Date(now);
      end.setHours(23, 59, 59, 999);
      return { startDate: start, endDate: end, label: 'Today' };
    }

    case 'yesterday': {
      const start = new Date(now);
      start.setDate(start.getDate() - 1);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setHours(23, 59, 59, 999);
      return { startDate: start, endDate: end, label: 'Yesterday' };
    }

    case 'custom': {
      if (!customDate) {
        throw new Error('Custom period requires a customDate parameter');
      }
      // Parse the date as local time (add T12:00:00 to avoid timezone issues)
      const dateObj = new Date(customDate + 'T12:00:00');
      const start = new Date(dateObj);
      start.setHours(0, 0, 0, 0);
      const end = new Date(dateObj);
      end.setHours(23, 59, 59, 999);
      // Format label as "Jan 15" style
      const label = dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      return { startDate: start, endDate: end, label };
    }

    case 'this_week': {
      // Get Monday of current week
      const start = new Date(now);
      const day = start.getDay();
      const diff = start.getDate() - day + (day === 0 ? -6 : 1);
      start.setDate(diff);
      start.setHours(0, 0, 0, 0);

      // Get Sunday of current week
      const end = new Date(start);
      end.setDate(end.getDate() + 6);
      end.setHours(23, 59, 59, 999);
      return { startDate: start, endDate: end, label: 'This Week' };
    }

    case 'last_week': {
      // Get Monday of LAST week
      const start = new Date(now);
      const day = start.getDay();
      const diff = start.getDate() - day + (day === 0 ? -6 : 1) - 7;
      start.setDate(diff);
      start.setHours(0, 0, 0, 0);

      // Get Sunday of last week
      const end = new Date(start);
      end.setDate(end.getDate() + 6);
      end.setHours(23, 59, 59, 999);
      return { startDate: start, endDate: end, label: 'Last Week' };
    }

    case 'this_month': {
      const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
      const monthName = now.toLocaleString('default', { month: 'long' });
      return { startDate: start, endDate: end, label: monthName };
    }

    case 'quarter': {
      const currentQ = getCurrentQuarter();
      const quarterInfo = getQuarterInfo(year || currentQ.year, quarter || currentQ.quarter);
      return {
        startDate: quarterInfo.startDate,
        endDate: new Date(Math.min(quarterInfo.endDate.getTime(), now.getTime())),
        label: quarterInfo.label,
      };
    }

    default:
      throw new Error(`Invalid period: ${period}`);
  }
}

// GET - Get call activity for an AE
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { ownerId } = await params;
    const supabase = await createServerSupabaseClient();

    // Parse query params
    const searchParams = request.nextUrl.searchParams;
    const period = (searchParams.get('period') || 'today') as CallPeriod;
    const year = searchParams.get('year') ? parseInt(searchParams.get('year')!) : undefined;
    const quarter = searchParams.get('quarter') ? parseInt(searchParams.get('quarter')!) : undefined;
    const customDate = searchParams.get('customDate'); // YYYY-MM-DD for custom period

    // Drill-down params
    const dateFilter = searchParams.get('date'); // YYYY-MM-DD
    const outcomeFilter = searchParams.get('outcome'); // outcome key (e.g., 'connected', 'leftVoicemail')
    const includeAssociations = searchParams.get('includeAssociations') === 'true';

    // Validate period
    const validPeriods: CallPeriod[] = ['today', 'yesterday', 'this_week', 'last_week', 'this_month', 'quarter', 'custom'];
    if (!validPeriods.includes(period)) {
      return NextResponse.json(
        { error: 'Invalid period. Must be one of: today, yesterday, this_week, last_week, this_month, quarter, custom' },
        { status: 400 }
      );
    }

    // Validate custom period has a date
    if (period === 'custom' && !customDate) {
      return NextResponse.json(
        { error: 'Custom period requires a customDate parameter (YYYY-MM-DD)' },
        { status: 400 }
      );
    }

    // Verify owner exists and get HubSpot owner ID
    const { data: owner, error: ownerError } = await supabase
      .from('owners')
      .select('id, first_name, last_name, email, hubspot_owner_id')
      .eq('id', ownerId)
      .single();

    if (ownerError || !owner) {
      return NextResponse.json({ error: 'Owner not found' }, { status: 404 });
    }

    // Get date range
    const { startDate, endDate, label } = getDateRange(period, year, quarter, customDate || undefined);

    // Fetch calls from HubSpot
    const calls = await fetchCallsByOwner(owner.hubspot_owner_id, startDate, endDate);

    // Calculate metrics
    const totalCalls = calls.length;
    const connectedCalls = calls.filter((c) => isConnectedOutcome(c.outcomeId)).length;
    const connectRate = totalCalls > 0 ? (connectedCalls / totalCalls) * 100 : 0;

    // Average duration (only for connected calls)
    const connectedCallsWithDuration = calls.filter((c) => isConnectedOutcome(c.outcomeId) && c.durationMs && c.durationMs > 0);
    const avgDurationMs = connectedCallsWithDuration.length > 0
      ? connectedCallsWithDuration.reduce((sum, c) => sum + (c.durationMs || 0), 0) / connectedCallsWithDuration.length
      : 0;

    // Outcome breakdown
    const outcomeBreakdown: OutcomeBreakdown = {
      connected: 0,
      leftVoicemail: 0,
      leftLiveMessage: 0,
      noAnswer: 0,
      wrongNumber: 0,
      busy: 0,
      unknown: 0,
    };

    for (const call of calls) {
      const key = getOutcomeKey(call.outcomeId);
      if (key in outcomeBreakdown) {
        outcomeBreakdown[key as keyof OutcomeBreakdown]++;
      }
    }

    // Daily trend (only for week/month/quarter views)
    const dailyTrend: DailyTrendPoint[] = [];

    if (period !== 'today') {
      // Group calls by date
      const dailyCounts = new Map<string, { calls: number; connected: number }>();

      // Initialize all dates in range
      const currentDate = new Date(startDate);
      const endTime = endDate.getTime();
      while (currentDate.getTime() <= endTime) {
        dailyCounts.set(formatDate(currentDate), { calls: 0, connected: 0 });
        currentDate.setDate(currentDate.getDate() + 1);
      }

      // Count calls per day
      for (const call of calls) {
        const dateKey = formatDate(call.timestamp);
        const existing = dailyCounts.get(dateKey);
        if (existing) {
          existing.calls++;
          if (isConnectedOutcome(call.outcomeId)) {
            existing.connected++;
          }
        }
      }

      // Convert to array
      for (const [date, counts] of dailyCounts) {
        dailyTrend.push({
          date,
          calls: counts.calls,
          connected: counts.connected,
        });
      }

      // Sort by date
      dailyTrend.sort((a, b) => a.date.localeCompare(b.date));
    }

    // If drill-down requested (date or outcome filter with associations)
    if ((dateFilter || outcomeFilter) && includeAssociations) {
      // Filter calls by date or outcome
      let filteredCalls: CallData[] = calls;
      let filterType: 'date' | 'outcome';
      let filterValue: string;
      let filterLabel: string;

      if (dateFilter) {
        // Filter to specific date
        filteredCalls = calls.filter((c) => formatDate(c.timestamp) === dateFilter);
        filterType = 'date';
        filterValue = dateFilter;
        // Format date for display
        const dateObj = new Date(dateFilter + 'T12:00:00');
        filterLabel = dateObj.toLocaleDateString('en-US', {
          weekday: 'long',
          month: 'long',
          day: 'numeric',
          year: 'numeric',
        });
      } else {
        // Filter by outcome key
        filteredCalls = calls.filter((c) => getOutcomeKey(c.outcomeId) === outcomeFilter);
        filterType = 'outcome';
        filterValue = outcomeFilter!;
        filterLabel = OUTCOME_KEY_LABELS[outcomeFilter!] || 'Unknown';
      }

      // Sort by timestamp descending (most recent first)
      filteredCalls.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

      // Fetch associations for filtered calls
      const callIds = filteredCalls.map((c) => c.id);
      const associations = await fetchCallAssociations(callIds);

      // Build detailed call data
      const callsWithAssociations: CallWithAssociations[] = filteredCalls.map((call) => {
        const assoc = associations.get(call.id) || { contacts: [], deals: [] };
        return {
          id: call.id,
          timestamp: call.timestamp.toISOString(),
          title: call.title,
          durationMs: call.durationMs,
          durationFormatted: formatCallDuration(call.durationMs),
          outcomeId: call.outcomeId,
          outcomeLabel: getOutcomeLabel(call.outcomeId),
          hubspotUrl: getHubSpotCallUrl(call.id),
          contacts: assoc.contacts,
          deals: assoc.deals,
        };
      });

      const drillDownResponse: CallDrillDownResponse = {
        owner: {
          id: owner.id,
          firstName: owner.first_name,
          lastName: owner.last_name,
          email: owner.email,
        },
        period: {
          type: period,
          label,
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
        },
        summary: {
          totalCalls,
          connectedCalls,
          connectRate: Math.round(connectRate * 10) / 10,
          avgDurationMs: Math.round(avgDurationMs),
          avgDurationFormatted: formatCallDuration(avgDurationMs),
        },
        outcomeBreakdown,
        dailyTrend,
        calls: callsWithAssociations,
        filter: {
          type: filterType,
          value: filterValue,
          label: filterLabel,
        },
      };

      return NextResponse.json(drillDownResponse);
    }

    const response: CallActivityResponse = {
      owner: {
        id: owner.id,
        firstName: owner.first_name,
        lastName: owner.last_name,
        email: owner.email,
      },
      period: {
        type: period,
        label,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
      },
      summary: {
        totalCalls,
        connectedCalls,
        connectRate: Math.round(connectRate * 10) / 10,
        avgDurationMs: Math.round(avgDurationMs),
        avgDurationFormatted: formatCallDuration(avgDurationMs),
      },
      outcomeBreakdown,
      dailyTrend,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Call activity API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
