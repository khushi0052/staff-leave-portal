-- Preserve Cancelled as a separate historical state.
-- Deploy this migration BEFORE the RPC in the next migration.
ALTER TYPE public.leave_status ADD VALUE IF NOT EXISTS 'withdrawn';
