ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS customer_ref TEXT NOT NULL DEFAULT '';

UPDATE tickets
SET customer_ref = CASE
  WHEN BTRIM(customer_email) <> '' THEN 'email:' || LOWER(BTRIM(customer_email))
  WHEN BTRIM(conversation_id) <> '' THEN 'conversation:' || BTRIM(conversation_id)
  ELSE ''
END
WHERE customer_ref = '';

CREATE INDEX IF NOT EXISTS idx_tickets_customer_ref
  ON tickets(shop_id, customer_ref)
  WHERE customer_ref <> '';
