-- Enable Supabase Realtime for Action Board tables
-- Phase 1: Real-Time UI Foundation

ALTER PUBLICATION supabase_realtime ADD TABLE ticket_action_board_analyses;
ALTER PUBLICATION supabase_realtime ADD TABLE action_item_completions;
ALTER PUBLICATION supabase_realtime ADD TABLE progress_notes;
ALTER PUBLICATION supabase_realtime ADD TABLE support_tickets;
