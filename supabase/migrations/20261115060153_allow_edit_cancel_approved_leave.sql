
-- =====================================================
-- EDIT / POSTPONE LEAVE
-- Pending: remains Pending
-- Approved: returns to Pending for reapproval
-- Rejected / Cancelled: cannot be edited
-- =====================================================

CREATE OR REPLACE FUNCTION public.edit_leave(
    p_id uuid,
    p_type public.leave_type,
    p_start date,
    p_end date,
    p_reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_owner uuid;
    v_request public.leave_requests%ROWTYPE;
    v_days integer;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'not_authenticated';
    END IF;

    -- Identify the request owner.
    SELECT r.user_id
    INTO v_owner
    FROM public.leave_requests r
    WHERE r.id = p_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'not_found';
    END IF;

    -- Employees can only edit their own requests.
    IF v_owner <> auth.uid() THEN
        RAISE EXCEPTION 'forbidden';
    END IF;

    -- Lock employee profile first to serialize
    -- changes that affect Annual leave entitlement.
    PERFORM 1
    FROM public.profiles p
    WHERE p.id = v_owner
    FOR UPDATE;

    -- Lock the request before modifying it.
    SELECT *
    INTO v_request
    FROM public.leave_requests r
    WHERE r.id = p_id
    FOR UPDATE;

    IF NOT FOUND OR v_request.user_id <> auth.uid() THEN
        RAISE EXCEPTION 'forbidden';
    END IF;

    -- Only Pending and Approved leave can be edited.
    IF v_request.status NOT IN ('pending', 'approved') THEN
        RAISE EXCEPTION 'cannot_edit_request';
    END IF;

    -- Validate the new dates, reason and entitlement.
    -- Excluding this request prevents its old Annual
    -- days from being counted twice.
    v_days := public.validate_leave(
        v_owner,
        p_type,
        p_start,
        p_end,
        p_reason,
        p_id
    );

    -- Editing an Approved request removes the old
    -- approval and requires a fresh manager decision.
    UPDATE public.leave_requests
    SET leave_type = p_type,
        start_date = p_start,
        end_date = p_end,
        working_days = v_days,
        reason = p_reason,
        status = 'pending',
        decided_by = NULL,
        decision_comment = NULL,
        updated_at = now()
    WHERE id = p_id;

    -- Record the change in the audit trail.
    INSERT INTO public.leave_audit (
        request_id,
        old_status,
        new_status,
        changed_by,
        comment
    )
    VALUES (
        p_id,
        v_request.status,
        'pending',
        auth.uid(),
        CASE
            WHEN v_request.status = 'approved'
                THEN 'Approved leave edited; resubmitted for approval'
            ELSE
                'Pending leave edited'
        END
    );
END;
$function$;


-- =====================================================
-- CANCEL LEAVE
-- Owners may cancel Pending or Approved leave.
-- Existing Manager and HR cancellation rules remain.
-- Rejected / Cancelled requests cannot be cancelled.
-- =====================================================

CREATE OR REPLACE FUNCTION public.cancel_leave(
    p_id uuid,
    p_comment text DEFAULT NULL::text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_owner uuid;
    v_request public.leave_requests%ROWTYPE;
    v_actor_role public.user_role;
    v_actor_dept uuid;
    v_owner_role public.user_role;
    v_allowed boolean := false;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'not_authenticated';
    END IF;

    IF char_length(coalesce(p_comment, '')) > 1000 THEN
        RAISE EXCEPTION 'comment_too_long';
    END IF;

    -- Identify the signed-in user's role.
    SELECT p.role, p.department_id
    INTO v_actor_role, v_actor_dept
    FROM public.profiles p
    WHERE p.id = auth.uid();

    -- Identify the request owner.
    SELECT r.user_id
    INTO v_owner
    FROM public.leave_requests r
    WHERE r.id = p_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'not_found';
    END IF;

    -- Lock the owner's profile first.
    SELECT p.role
    INTO v_owner_role
    FROM public.profiles p
    WHERE p.id = v_owner
    FOR UPDATE;

    -- Lock the request.
    SELECT *
    INTO v_request
    FROM public.leave_requests r
    WHERE r.id = p_id
    FOR UPDATE;

    IF NOT FOUND OR v_request.user_id <> v_owner THEN
        RAISE EXCEPTION 'not_found';
    END IF;

    -- Owners can cancel their own Pending
    -- or Approved leave requests.
    IF v_owner = auth.uid()
       AND v_request.status IN ('pending', 'approved') THEN
        v_allowed := true;
    END IF;

    -- Managers can cancel department staff leave,
    -- but cannot act on their own requests here.
    IF v_actor_role = 'manager'
       AND v_owner <> auth.uid()
       AND v_owner_role = 'staff'
       AND v_request.department_id = v_actor_dept
       AND v_request.status IN ('pending', 'approved') THEN
        v_allowed := true;
    END IF;

    -- HR can cancel other users' eligible requests.
    IF v_actor_role = 'hr'
       AND v_owner <> auth.uid()
       AND v_request.status IN ('pending', 'approved') THEN
        v_allowed := true;
    END IF;

    IF NOT v_allowed THEN
        RAISE EXCEPTION 'cannot_cancel_request';
    END IF;

    -- Cancel the request and clear its old decision.
    UPDATE public.leave_requests
    SET status = 'cancelled',
        updated_at = now()
    WHERE id = p_id;

    -- Preserve the cancellation in the audit trail.
    INSERT INTO public.leave_audit (
        request_id,
        old_status,
        new_status,
        changed_by,
        comment
    )
    VALUES (
        p_id,
        v_request.status,
        'cancelled',
        auth.uid(),
        p_comment
    );
END;
$function$;
