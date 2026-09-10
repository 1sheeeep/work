ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS record_order_number TEXT NOT NULL DEFAULT '';
