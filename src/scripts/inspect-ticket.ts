import { config } from 'dotenv';
config({ path: '.env.local' });

import { createServiceClient } from '../lib/supabase/client';
import { getTicketEngagementTimeline } from '../lib/hubspot/ticket-engagements';

// --- Argument Parsing ---

function parseArgs() {
  const args = process.argv.slice(2);
  let ticketId: string | null = null;
  let company: string | null = null;
  let subject: string | null = null;
  let showEngagements = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--company' && args[i + 1]) {
      company = args[++i];
    } else if (args[i] === '--subject' && args[i + 1]) {
      subject = args[++i];
    } else if (args[i] === '--engagements') {
      showEngagements = true;
    } else if (!args[i].startsWith('--')) {
      ticketId = args[i];
    }
  }

  if (!ticketId && !company && !subject) {
    console.log('Usage:');
    console.log('  npx tsx src/scripts/inspect-ticket.ts <hubspot_ticket_id>');
    console.log('  npx tsx src/scripts/inspect-ticket.ts --company "True North"');
    console.log('  npx tsx src/scripts/inspect-ticket.ts --subject "billing sync"');
    console.log('');
    console.log('Flags:');
    console.log('  --engagements   Include HubSpot engagement timeline');
    process.exit(1);
  }

  return { ticketId, company, subject, showEngagements };
}

// --- Helpers ---

function header(title: string) {
  console.log('\n' + '='.repeat(70));
  console.log(`  ${title}`);
  console.log('='.repeat(70));
}

function subheader(title: string) {
  console.log(`\n--- ${title} ---\n`);
}

function field(label: string, value: unknown) {
  const display = value === null || value === undefined ? '—' : String(value);
  console.log(`  ${label.padEnd(30)} ${display}`);
}

function jsonBlock(data: unknown) {
  console.log(JSON.stringify(data, null, 2).split('\n').map(l => `  ${l}`).join('\n'));
}

// --- Main ---

async function main() {
  const { ticketId, company, subject, showEngagements } = parseArgs();
  const supabase = createServiceClient();

  // Resolve ticket ID
  let resolvedTicketId = ticketId;

  if (company) {
    const { data: matches, error } = await supabase
      .from('support_tickets')
      .select('hubspot_ticket_id, subject, hs_primary_company_name, is_closed, hubspot_created_at')
      .ilike('hs_primary_company_name', `%${company}%`)
      .eq('is_closed', false)
      .order('hubspot_created_at', { ascending: false })
      .limit(20);

    if (error || !matches || matches.length === 0) {
      console.log(`No open tickets found for company matching "${company}"`);
      process.exit(1);
    }

    if (matches.length > 1) {
      console.log(`Found ${matches.length} open tickets matching "${company}":\n`);
      matches.forEach((t, i) => {
        console.log(`  ${i + 1}. [${t.hubspot_ticket_id}] ${t.hs_primary_company_name} — ${t.subject || 'No subject'}`);
      });
      console.log(`\nRe-run with the specific ticket ID, e.g.:`);
      console.log(`  npx tsx src/scripts/inspect-ticket.ts ${matches[0].hubspot_ticket_id}`);
      process.exit(0);
    }

    resolvedTicketId = matches[0].hubspot_ticket_id;
    console.log(`Matched: [${resolvedTicketId}] ${matches[0].hs_primary_company_name} — ${matches[0].subject}`);
  }

  if (subject) {
    const { data: matches, error } = await supabase
      .from('support_tickets')
      .select('hubspot_ticket_id, subject, hs_primary_company_name, is_closed, hubspot_created_at')
      .ilike('subject', `%${subject}%`)
      .eq('is_closed', false)
      .order('hubspot_created_at', { ascending: false })
      .limit(20);

    if (error || !matches || matches.length === 0) {
      console.log(`No open tickets found with subject matching "${subject}"`);
      process.exit(1);
    }

    if (matches.length > 1) {
      console.log(`Found ${matches.length} open tickets matching subject "${subject}":\n`);
      matches.forEach((t, i) => {
        console.log(`  ${i + 1}. [${t.hubspot_ticket_id}] ${t.hs_primary_company_name} — ${t.subject || 'No subject'}`);
      });
      console.log(`\nRe-run with the specific ticket ID, e.g.:`);
      console.log(`  npx tsx src/scripts/inspect-ticket.ts ${matches[0].hubspot_ticket_id}`);
      process.exit(0);
    }

    resolvedTicketId = matches[0].hubspot_ticket_id;
    console.log(`Matched: [${resolvedTicketId}] ${matches[0].hs_primary_company_name} — ${matches[0].subject}`);
  }

  if (!resolvedTicketId) {
    console.log('Could not resolve ticket ID.');
    process.exit(1);
  }

  // ===================================================================
  // SECTION 1: Ticket Metadata
  // ===================================================================
  header('TICKET METADATA');

  const { data: ticket, error: ticketError } = await supabase
    .from('support_tickets')
    .select('*')
    .eq('hubspot_ticket_id', resolvedTicketId)
    .single();

  if (ticketError || !ticket) {
    console.log(`  Ticket ${resolvedTicketId} not found in database.`);
    if (ticketError) console.log(`  Error: ${ticketError.message}`);
    process.exit(1);
  }

  const ageDays = ticket.hubspot_created_at
    ? Math.round((Date.now() - new Date(ticket.hubspot_created_at).getTime()) / (1000 * 60 * 60 * 24))
    : null;

  // Resolve owner name
  let ownerName: string | null = null;
  if (ticket.hubspot_owner_id) {
    const { data: owner } = await supabase
      .from('owners')
      .select('first_name, last_name, email')
      .eq('hubspot_owner_id', ticket.hubspot_owner_id)
      .single();
    if (owner) {
      ownerName = [owner.first_name, owner.last_name].filter(Boolean).join(' ') || owner.email || null;
    }
  }

  field('HubSpot Ticket ID', resolvedTicketId);
  field('Subject', ticket.subject);
  field('Company', ticket.hs_primary_company_name);
  field('Assigned Rep', ownerName || `Owner ID: ${ticket.hubspot_owner_id || 'Unassigned'}`);
  field('Status', ticket.is_closed ? 'Closed' : 'Open');
  field('Age', ageDays !== null ? `${ageDays} days` : 'Unknown');
  field('Source', ticket.source_type);
  field('Priority', ticket.priority);
  field('Ball In Court', ticket.ball_in_court);
  field('Software', ticket.software);
  field('Ticket Type', ticket.ticket_type);
  field('Category', ticket.category);
  field('Pipeline Stage', ticket.pipeline_stage);
  field('Linear Task', ticket.linear_task);
  field('FRT SLA Breached', ticket.frt_sla_breached);
  field('NRT SLA Breached', ticket.nrt_sla_breached);
  console.log('');
  subheader('Timestamps');
  field('Created (HubSpot)', ticket.hubspot_created_at);
  field('Last Customer Message', ticket.last_customer_message_at);
  field('Last Agent Message', ticket.last_agent_message_at);
  field('Last Contacted', ticket.last_contacted_at);
  field('Closed Date', ticket.closed_date);
  field('Synced At', ticket.synced_at);

  // ===================================================================
  // SECTION 2: Action Board Analysis
  // ===================================================================
  header('ACTION BOARD ANALYSIS');

  const { data: actionAnalysis } = await supabase
    .from('ticket_action_board_analyses')
    .select('*')
    .eq('hubspot_ticket_id', resolvedTicketId)
    .single();

  if (!actionAnalysis) {
    console.log('  No action board analysis found.');
  } else {
    field('Analyzed At', actionAnalysis.analyzed_at);
    field('Confidence', actionAnalysis.confidence);
    field('Customer Temperature', actionAnalysis.customer_temperature);
    field('Temperature Reason', actionAnalysis.temperature_reason);
    field('Status Tags', (actionAnalysis.status_tags || []).join(', '));
    field('Hours Since Cust Waiting', actionAnalysis.hours_since_customer_waiting);
    field('Hours Since Last Outbound', actionAnalysis.hours_since_last_outbound);
    field('Hours Since Last Activity', actionAnalysis.hours_since_last_activity);
    field('Knowledge Used', actionAnalysis.knowledge_used);

    subheader('Situation Summary');
    console.log(`  ${actionAnalysis.situation_summary}`);

    subheader('Action Items');
    const items = actionAnalysis.action_items || [];
    if (items.length === 0) {
      console.log('  No action items.');
    } else {
      items.forEach((item: { id: string; description: string; who: string; priority: string; status_tags: string[] }, i: number) => {
        console.log(`  ${i + 1}. [${item.priority?.toUpperCase()}] [${item.who}]`);
        console.log(`     ${item.description}`);
        if (item.status_tags?.length > 0) console.log(`     Tags: ${item.status_tags.join(', ')}`);
        console.log('');
      });
    }

    subheader('Response Guidance');
    console.log(`  ${actionAnalysis.response_guidance || '—'}`);

    subheader('Response Draft');
    console.log(`  ${actionAnalysis.response_draft || '(NO_REPLY_NEEDED)'}`);

    subheader('Context Snapshot');
    console.log(`  ${actionAnalysis.context_snapshot || '—'}`);

    if (actionAnalysis.related_tickets?.length > 0) {
      subheader('Related Tickets');
      actionAnalysis.related_tickets.forEach((rt: { ticketId: string; subject: string; summary: string }) => {
        console.log(`  - [${rt.ticketId}] ${rt.subject}`);
        if (rt.summary) console.log(`    ${rt.summary}`);
      });
    }
  }

  // ===================================================================
  // SECTION 3: Trainer Analysis
  // ===================================================================
  header('TRAINER ANALYSIS');

  const { data: trainerAnalysis } = await supabase
    .from('ticket_trainer_analyses')
    .select('*')
    .eq('hubspot_ticket_id', resolvedTicketId)
    .single();

  if (!trainerAnalysis) {
    console.log('  No trainer analysis found.');
  } else {
    field('Analyzed At', trainerAnalysis.analyzed_at);
    field('Confidence', trainerAnalysis.confidence);
    field('Difficulty Level', trainerAnalysis.difficulty_level);
    field('Knowledge Areas', trainerAnalysis.knowledge_areas);

    subheader('Customer Ask');
    console.log(`  ${trainerAnalysis.customer_ask || '—'}`);

    subheader('Problem Breakdown');
    console.log(`  ${trainerAnalysis.problem_breakdown || '—'}`);

    subheader('System Explanation');
    console.log(`  ${trainerAnalysis.system_explanation || '—'}`);

    subheader('Interaction Timeline');
    console.log(`  ${trainerAnalysis.interaction_timeline || '—'}`);

    subheader('Resolution Approach');
    console.log(`  ${trainerAnalysis.resolution_approach || '—'}`);

    subheader('Coaching Tips');
    console.log(`  ${trainerAnalysis.coaching_tips || '—'}`);
  }

  // ===================================================================
  // SECTION 4: Manager Analysis
  // ===================================================================
  header('MANAGER ANALYSIS');

  const { data: managerAnalysis } = await supabase
    .from('ticket_support_manager_analyses')
    .select('*')
    .eq('hubspot_ticket_id', resolvedTicketId)
    .single();

  if (!managerAnalysis) {
    console.log('  No manager analysis found.');
  } else {
    field('Analyzed At', managerAnalysis.analyzed_at);
    field('Confidence', managerAnalysis.confidence);
    field('Urgency', managerAnalysis.urgency);
    field('Action Owner', managerAnalysis.action_owner);
    field('Days Since Last Activity', managerAnalysis.days_since_last_activity);
    field('Last Activity By', managerAnalysis.last_activity_by);
    field('Knowledge Used', managerAnalysis.knowledge_used);

    subheader('Issue Summary');
    console.log(`  ${managerAnalysis.issue_summary || '—'}`);

    subheader('Next Action');
    console.log(`  ${managerAnalysis.next_action || '—'}`);

    subheader('Reasoning');
    console.log(`  ${managerAnalysis.reasoning || '—'}`);

    subheader('Engagement Summary');
    console.log(`  ${managerAnalysis.engagement_summary || '—'}`);

    subheader('Linear Summary');
    console.log(`  ${managerAnalysis.linear_summary || '—'}`);

    if (managerAnalysis.follow_up_cadence) {
      subheader('Follow-Up Cadence');
      console.log(`  ${managerAnalysis.follow_up_cadence}`);
    }
  }

  // ===================================================================
  // SECTION 5: Action Item Completions
  // ===================================================================
  header('ACTION ITEM COMPLETIONS');

  const { data: completions } = await supabase
    .from('action_item_completions')
    .select('*')
    .eq('hubspot_ticket_id', resolvedTicketId)
    .order('completed_at', { ascending: false })
    .limit(20);

  if (!completions || completions.length === 0) {
    console.log('  No action item completions.');
  } else {
    // Resolve user names
    const userIds = [...new Set(completions.map(c => c.completed_by))];
    const { data: users } = await supabase
      .from('user_profiles')
      .select('id, display_name, email')
      .in('id', userIds);
    const userMap = new Map((users || []).map(u => [u.id, u.display_name || u.email || 'Unknown']));

    completions.forEach((c, i) => {
      const who = userMap.get(c.completed_by) || 'Unknown';
      const verified = c.verified === true ? ' [VERIFIED]' : c.verified === false ? ' [UNVERIFIED]' : '';
      console.log(`  ${i + 1}. "${c.action_description}"${verified}`);
      console.log(`     Completed by: ${who} at ${c.completed_at}`);
      if (c.verification_note) console.log(`     Note: ${c.verification_note}`);
      console.log('');
    });
  }

  // ===================================================================
  // SECTION 6: Today's Shift Reviews
  // ===================================================================
  header("TODAY'S SHIFT REVIEWS");

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const { data: reviews } = await supabase
    .from('shift_reviews')
    .select('*')
    .eq('hubspot_ticket_id', resolvedTicketId)
    .gte('reviewed_at', todayStart.toISOString())
    .order('reviewed_at', { ascending: false });

  if (!reviews || reviews.length === 0) {
    console.log('  No shift reviews today.');
  } else {
    const reviewerIds = [...new Set(reviews.map(r => r.user_id))];
    const { data: reviewers } = await supabase
      .from('user_profiles')
      .select('id, display_name, email')
      .in('id', reviewerIds);
    const reviewerMap = new Map((reviewers || []).map(u => [u.id, u.display_name || u.email || 'Unknown']));

    reviews.forEach((r, i) => {
      const who = reviewerMap.get(r.user_id) || 'Unknown';
      console.log(`  ${i + 1}. ${who} — ${r.acknowledgment_tag} (${r.reviewed_at})`);
      if (r.attention_target) console.log(`     Attention target: ${r.attention_target}`);
      if (r.blocked_reason) console.log(`     Blocked reason: ${r.blocked_reason}`);
      if (r.shift_note) console.log(`     Note: ${r.shift_note}`);
      console.log('');
    });
  }

  // ===================================================================
  // SECTION 7: Engagement Timeline (optional)
  // ===================================================================
  if (showEngagements) {
    header('HUBSPOT ENGAGEMENT TIMELINE');

    try {
      const timeline = await getTicketEngagementTimeline(resolvedTicketId);
      console.log(`  Total engagements: ${timeline.counts.total}`);
      console.log(`  Emails: ${timeline.counts.emails} | Notes: ${timeline.counts.notes} | Calls: ${timeline.counts.calls} | Meetings: ${timeline.counts.meetings}\n`);

      if (timeline.engagements.length === 0) {
        console.log('  No engagements found.');
      } else {
        timeline.engagements.forEach((e) => {
          const ts = e.timestamp.toISOString().split('T')[0];
          const parts = [`  [${ts}] ${e.type.toUpperCase()}`];
          if (e.author) parts.push(`by ${e.author}`);
          if (e.direction) parts.push(`(${e.direction})`);
          if (e.subject) parts.push(`— ${e.subject}`);
          console.log(parts.join(' '));
          if (e.body) {
            const bodySnippet = e.body.slice(0, 500).replace(/\n/g, '\n    ');
            console.log(`    ${bodySnippet}`);
          }
          if (e.duration) console.log(`    Duration: ${Math.round(e.duration / 60)}min`);
          console.log('');
        });
      }
    } catch (err) {
      console.log(`  Error fetching engagements: ${err instanceof Error ? err.message : err}`);
    }
  }

  console.log('\n' + '='.repeat(70));
  console.log('  INSPECTION COMPLETE');
  console.log('='.repeat(70) + '\n');
}

main().catch(console.error);
