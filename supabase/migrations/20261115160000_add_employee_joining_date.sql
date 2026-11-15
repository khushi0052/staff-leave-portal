-- Track start date; the HR-only Edge Function sets the date and initial entitlement.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS joining_date date;
