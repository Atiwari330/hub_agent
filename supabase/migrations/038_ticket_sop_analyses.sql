-- Migration: 038_ticket_sop_analyses.sql
-- SOP Compliance & Coverage Audit Pipeline
-- Stores per-ticket SOP classification, compliance scoring, and gap analysis.

CREATE TABLE IF NOT EXISTS ticket_sop_analyses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hubspot_ticket_id TEXT UNIQUE NOT NULL,

  -- Classification fields (per SOP framework)
  sop_product_area TEXT NOT NULL,
  sop_issue_type TEXT NOT NULL,
  sop_severity TEXT NOT NULL CHECK (sop_severity IN ('sev_1', 'sev_2', 'sev_3', 'needs_triage')),
  sop_recommended_routing TEXT NOT NULL,
  sop_authorization_required TEXT NOT NULL CHECK (sop_authorization_required IN ('yes', 'no', 'unclear')),
  classification_confidence DECIMAL(3,2) NOT NULL CHECK (classification_confidence BETWEEN 0 AND 1),
  classification_reasoning TEXT NOT NULL,

  -- Compliance dimension scores (0-10 each)
  triage_compliance_score INTEGER NOT NULL CHECK (triage_compliance_score BETWEEN 0 AND 10),
  triage_assessment TEXT NOT NULL,
  routing_compliance_score INTEGER NOT NULL CHECK (routing_compliance_score BETWEEN 0 AND 10),
  routing_assessment TEXT NOT NULL,
  authorization_compliance_score INTEGER NOT NULL CHECK (authorization_compliance_score BETWEEN 0 AND 10),
  authorization_assessment TEXT NOT NULL,
  communication_compliance_score INTEGER NOT NULL CHECK (communication_compliance_score BETWEEN 0 AND 10),
  communication_assessment TEXT NOT NULL,
  documentation_compliance_score INTEGER NOT NULL CHECK (documentation_compliance_score BETWEEN 0 AND 10),
  documentation_assessment TEXT NOT NULL,
  vendor_compliance_score INTEGER CHECK (vendor_compliance_score BETWEEN 0 AND 10),
  vendor_assessment TEXT,

  -- Overall compliance
  compliance_score INTEGER NOT NULL CHECK (compliance_score BETWEEN 0 AND 100),
  compliance_grade TEXT NOT NULL CHECK (compliance_grade IN ('A', 'B', 'C', 'D', 'F')),

  -- Coverage / gap fields
  clean_fit BOOLEAN NOT NULL DEFAULT TRUE,
  ambiguity_flags TEXT,
  sop_gap_identified BOOLEAN NOT NULL DEFAULT FALSE,
  sop_gap_description TEXT,
  sop_gap_severity TEXT CHECK (sop_gap_severity IN ('critical', 'high', 'medium', 'low')),
  edge_case_notes TEXT,
  key_evidence TEXT,

  -- Denormalized context
  ticket_subject TEXT,
  company_name TEXT,
  is_closed BOOLEAN DEFAULT FALSE,
  assigned_rep TEXT,
  analyzed_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE UNIQUE INDEX idx_tsa_ticket ON ticket_sop_analyses(hubspot_ticket_id);
CREATE INDEX idx_tsa_product_area ON ticket_sop_analyses(sop_product_area);
CREATE INDEX idx_tsa_issue_type ON ticket_sop_analyses(sop_issue_type);
CREATE INDEX idx_tsa_compliance_grade ON ticket_sop_analyses(compliance_grade);
CREATE INDEX idx_tsa_gap ON ticket_sop_analyses(sop_gap_identified);
CREATE INDEX idx_tsa_rep ON ticket_sop_analyses(assigned_rep);

-- Row Level Security
ALTER TABLE ticket_sop_analyses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view ticket_sop_analyses"
  ON ticket_sop_analyses FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Service role manages ticket_sop_analyses"
  ON ticket_sop_analyses FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role');
