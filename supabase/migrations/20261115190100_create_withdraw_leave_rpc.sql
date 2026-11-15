-- Called only by the request owner. The UPDATE is atomic and race-safe:
-- exactly one transition pending -> withdrawn, no edits to approved/rejected requests.
-- SECURITY DEFINER is needed only if the existing RLS rules do not allow
-- employees to directly UPDATE leave_requests.
CREATE OR REPLACE FUNCTION public.withdraw_leave(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in to withdraw a leave request';
  END IF;

  UPDATE public.leave_requests
  SET status = 'withdrawn',
      updated_at = now()
  WHERE id = p_id
    AND user_id = auth.uid()
    AND status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Only your own pending leave requests can be withdrawn';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.withdraw_leave(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.withdraw_leave(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.withdraw_leave(uuid) TO authenticated;
