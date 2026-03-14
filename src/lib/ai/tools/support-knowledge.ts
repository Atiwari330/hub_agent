import { tool } from 'ai';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';

const KNOWLEDGE_DIR = path.join(process.cwd(), 'src', 'lib', 'ai', 'knowledge', 'support');

const CATEGORIES = {
  // --- EHR Knowledge Areas ---
  'rcm-claims-flow':
    'Revenue cycle management, claims flow, billing pipeline (schedule → encounter → claim → Imagine/Opus RCM), PracticeSuite (legacy), ERA/payment issues',
  'scheduling':
    'Scheduling appointments, group sessions, recurrence, calendar management, availability, wait list, appointment-linked documentation, services settings',
  'todo-list':
    'TO DO list, task system, documentation requirements linked to appointments, completing from TO DO vs chart, supervisor signature workflow',
  'client-management':
    'Patient/client entry, demographics, insurance setup, patient screen filtering, episode of care, patient portal access, utilization review tab',
  'clinical-documentation':
    'Clinical forms, templates, form builder components, creating/editing intakes, assessments, progress notes, treatment plans, ROI forms, form groups, document packages, document statuses (draft/pending/completed)',
  'reporting':
    'Available reports, report requests panel, tab-level exports, custom reports, billing tab as reporting tool, system logs/audit trail',
  'vendor-tickets':
    'Vendor-originated tickets from Imagine/ImaginePay/PracticeSuite, identifying vendor tickets, systemic risk',
  'medications-and-mars':
    'Medications tab, MARS (medication administration record), scheduled vs PRN medications, DoseSpot/E-Prescribe, EMAR vs MARS, predefined protocols, doctor orders',
  'user-roles-and-permissions':
    'User roles, permissions, missing tabs, caseload permissions, supervisor/supervisee settings, configuration access, document permissions, user management',
  'patient-portal':
    'Patient portal, new patient registration, appointment requests, document delivery/return statuses, patient check-in, portal messaging, payments, portal settings',
  'location-and-settings-configuration':
    'Location creation, forms per location, levels of care, places of service, reminder settings, hours of operation, global vs location-specific settings',
  'utilization-review':
    'Utilization review (UR), authorization tracking, level of care scheduling, outpatient auth numbers, billable group session hours, duration automation',
  // --- RCM Knowledge Areas ---
  'rcm-concepts-and-insurance-basics':
    'Insurance fundamentals (deductibles, copay, coinsurance, EOB, ERA), CMS-1500/HCFA, ICD-10, CPT codes, modifiers, clearinghouse (Phicure), revenue cycle lifecycle, claim flow step-by-step',
  'system-maintenance-and-setup':
    'RCM system maintenance: locations, providers, procedures, diagnosis codes, financial classes, fee schedules, insurance carriers, scheduled jobs, data sets/entities, conversions/code mapping',
  'ehr-rcm-sync-and-integration':
    'EHR↔RCM sync, handshake/token, GUID linking, Charge Central, conversions, file import log, audit history, EHR holds, demographic update queue',
  'patient-accounts-and-visits':
    'RCM patient accounts, visit lifecycle, visit actions (bill, corrected claim, void, merge), visit defaults, notes, unposted visits',
  'queues-and-workflow':
    'RCM queues: eligibility errors, demographic import errors, procedure import errors, pre-submission errors, claim status, outgoing claims, follow-up, credit balances, collections, unapplied payments, underpaid procedures, custom queues',
  'eligibility':
    'Eligibility verification, batch 270/271 transactions, scheduled jobs for eligibility, eligibility settings, excluding payers',
  'claims-billing-and-rules':
    'Claim lifecycle (scrubbing, submission, acceptance/rejection/denial), Rule Builder, corrected/void claims, mass rebuild, denial vs rejection distinction',
  'payments-and-transactions':
    'ERA/EOB processing, payment posting, unapplied payments, credit balances, refunds, write-offs, self-pay, collections workflow',
  'patient-payments-and-statements':
    'Imagine Pay (patient portal payments), paper statements, Imagine Everywhere (automated statements), statement holds, statement-to-collections cadence',
  'troubleshooting-and-escalation':
    'Tier 1 support scope, sandbox testing, IT Assistant ticketing, Phicure escalation, audit history navigation, common real-world issues',
} as const;

type SupportKnowledgeCategory = keyof typeof CATEGORIES;

const categoryKeys = Object.keys(CATEGORIES) as [SupportKnowledgeCategory, ...SupportKnowledgeCategory[]];

export const lookupSupportKnowledgeTool = tool({
  description: `Retrieve detailed product knowledge for a specific area of the Opus EHR system to inform ticket triage. Use this BEFORE making your triage recommendation when the ticket involves any of these system areas. You may call this multiple times for tickets that span multiple areas.

Available categories:
${Object.entries(CATEGORIES).map(([key, desc]) => `- "${key}": ${desc}`).join('\n')}`,
  inputSchema: z.object({
    category: z.enum(categoryKeys).describe('The system area to retrieve knowledge about'),
  }),
  execute: async ({ category }) => {
    const filePath = path.join(KNOWLEDGE_DIR, `${category}.md`);
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      return { category, content };
    } catch {
      return { category, content: `No knowledge file found for category: ${category}` };
    }
  },
});
