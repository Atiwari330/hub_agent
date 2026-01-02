-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Owners table (cached from HubSpot)
CREATE TABLE owners (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  hubspot_owner_id VARCHAR(50) UNIQUE NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  first_name VARCHAR(100),
  last_name VARCHAR(100),
  synced_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_owners_email ON owners(email);
CREATE INDEX idx_owners_hubspot_id ON owners(hubspot_owner_id);

-- Deals table (cached from HubSpot)
CREATE TABLE deals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  hubspot_deal_id VARCHAR(50) UNIQUE NOT NULL,
  deal_name VARCHAR(500) NOT NULL,
  amount DECIMAL(15, 2),
  close_date DATE,
  pipeline VARCHAR(100),
  deal_stage VARCHAR(100),
  description TEXT,
  owner_id UUID REFERENCES owners(id) ON DELETE SET NULL,
  hubspot_owner_id VARCHAR(50),
  synced_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_deals_owner ON deals(owner_id);
CREATE INDEX idx_deals_hubspot_id ON deals(hubspot_deal_id);
CREATE INDEX idx_deals_stage ON deals(deal_stage);
CREATE INDEX idx_deals_close_date ON deals(close_date);

-- Deal notes (cached from HubSpot)
CREATE TABLE deal_notes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  hubspot_note_id VARCHAR(50) UNIQUE NOT NULL,
  deal_id UUID REFERENCES deals(id) ON DELETE CASCADE,
  note_body TEXT,
  note_timestamp TIMESTAMP WITH TIME ZONE,
  synced_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_deal_notes_deal ON deal_notes(deal_id);

-- Sentiment analysis results
CREATE TABLE sentiment_analyses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  deal_id UUID REFERENCES deals(id) ON DELETE CASCADE,
  sentiment_score VARCHAR(20) NOT NULL CHECK (sentiment_score IN ('positive', 'neutral', 'negative')),
  confidence DECIMAL(3, 2) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  summary TEXT NOT NULL,
  key_factors JSONB,
  recommendations JSONB,
  analyzed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sentiment_deal ON sentiment_analyses(deal_id);
CREATE INDEX idx_sentiment_score ON sentiment_analyses(sentiment_score);
CREATE INDEX idx_sentiment_analyzed ON sentiment_analyses(analyzed_at);

-- Workflow runs (for tracking scheduled jobs)
CREATE TABLE workflow_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workflow_name VARCHAR(100) NOT NULL,
  status VARCHAR(20) NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE,
  result JSONB,
  error TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_workflow_name ON workflow_runs(workflow_name);
CREATE INDEX idx_workflow_status ON workflow_runs(status);
CREATE INDEX idx_workflow_started ON workflow_runs(started_at);

-- Agent conversation logs (optional, for debugging/improvement)
CREATE TABLE agent_conversations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  prompt TEXT NOT NULL,
  response TEXT NOT NULL,
  tools_used JSONB,
  duration_ms INTEGER,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_conversations_created ON agent_conversations(created_at);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers for updated_at
CREATE TRIGGER update_owners_updated_at
  BEFORE UPDATE ON owners
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_deals_updated_at
  BEFORE UPDATE ON deals
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
