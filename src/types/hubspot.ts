import { z } from 'zod';

// Owner/Account Executive schema
export const HubSpotOwnerSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  userId: z.number().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  archived: z.boolean().optional(),
});

export type HubSpotOwner = z.infer<typeof HubSpotOwnerSchema>;

// Deal schema
export const HubSpotDealSchema = z.object({
  id: z.string(),
  properties: z.object({
    dealname: z.string(),
    amount: z.string().nullable().optional(),
    closedate: z.string().nullable().optional(),
    pipeline: z.string().nullable().optional(),
    dealstage: z.string().nullable().optional(),
    hubspot_owner_id: z.string().nullable().optional(),
    createdate: z.string().nullable().optional(),
    hs_lastmodifieddate: z.string().nullable().optional(),
    notes_last_updated: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    // New properties for dashboard display
    lead_source: z.string().nullable().optional(),
    notes_next_activity_date: z.string().nullable().optional(),
    hs_next_step: z.string().nullable().optional(),
    product_s: z.string().nullable().optional(),
    proposal_stage: z.string().nullable().optional(),
    // Stage entry timestamps for weekly pipeline tracking
    // These use the HubSpot stage IDs as property names
    'hs_v2_date_entered_17915773': z.string().nullable().optional(), // SQL
    'hs_v2_date_entered_baedc188-ba76-4a41-8723-5bb99fe7c5bf': z.string().nullable().optional(), // Demo Scheduled
    'hs_v2_date_entered_963167283': z.string().nullable().optional(), // Demo Completed
    'hs_v2_date_entered_97b2bcc6-fb34-4b56-8e6e-c349c88ef3d5': z.string().nullable().optional(), // Closed Won
  }),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  archived: z.boolean().optional(),
});

export type HubSpotDeal = z.infer<typeof HubSpotDealSchema>;

// Note/Engagement schema
export const HubSpotNoteSchema = z.object({
  id: z.string(),
  properties: z.object({
    hs_note_body: z.string().nullable().optional(),
    hs_timestamp: z.string().nullable().optional(),
    hubspot_owner_id: z.string().nullable().optional(),
  }),
});

export type HubSpotNote = z.infer<typeof HubSpotNoteSchema>;

// Pagination
export const PagingSchema = z.object({
  next: z.object({
    after: z.string(),
    link: z.string().optional(),
  }).optional(),
});

export type Paging = z.infer<typeof PagingSchema>;
