
-- Enable an extension for our future overlap constraint.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Define the three types of leave employees can request.
CREATE TYPE leave_type AS ENUM (
    'annual',
    'sick',
    'unpaid'
);

-- Define the possible states of a leave request.
CREATE TYPE leave_status AS ENUM (
    'pending',
    'approved',
    'rejected',
    'cancelled'
);

-- Define the roles users can have.
CREATE TYPE user_role AS ENUM (
    'staff',
    'manager',
    'hr'
);

-- Store the company's departments.
CREATE TABLE public.departments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE
);


-- Store employee information linked to Supabase Auth.
CREATE TABLE public.profiles (
    id UUID PRIMARY KEY
        REFERENCES auth.users(id) ON DELETE CASCADE,

    full_name TEXT NOT NULL,

    email TEXT NOT NULL UNIQUE,

    role user_role NOT NULL DEFAULT 'staff',

    department_id UUID NOT NULL
        REFERENCES public.departments(id),

    annual_entitlement INTEGER NOT NULL
        CHECK (annual_entitlement >= 0)
);

-- Store public holidays excluded from leave calculations.
CREATE TABLE public.public_holidays (
    date DATE PRIMARY KEY,
    name TEXT NOT NULL
);

-- =========================================================
-- 1. LEAVE REQUESTS TABLE
-- =========================================================

CREATE TABLE public.leave_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    user_id UUID NOT NULL
        REFERENCES public.profiles(id),

    department_id UUID NOT NULL
        REFERENCES public.departments(id),

    leave_type public.leave_type NOT NULL,

    start_date DATE NOT NULL,
    end_date DATE NOT NULL,

    working_days INTEGER NOT NULL
        CHECK (working_days > 0),

    reason TEXT
        CHECK (char_length(reason) <= 1000),

    status public.leave_status NOT NULL DEFAULT 'pending',

    decided_by UUID REFERENCES public.profiles(id),

    decision_comment TEXT
        CHECK (char_length(decision_comment) <= 1000),

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT valid_date_range
        CHECK (end_date >= start_date),

    CONSTRAINT unpaid_reason_required
        CHECK (
            leave_type <> 'unpaid'
            OR length(trim(coalesce(reason, ''))) > 0
        ),

    -- An employee cannot have overlapping active requests.
    -- The [] makes BOTH start and end dates inclusive.
    CONSTRAINT no_overlap
        EXCLUDE USING gist (
            user_id WITH =,
            daterange(start_date, end_date, '[]') WITH &&
        )
        WHERE (status IN ('pending', 'approved'))
);


-- =========================================================
-- 2. AUDIT TABLES
-- =========================================================

-- Every leave status change is recorded here.
CREATE TABLE public.leave_audit (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    request_id UUID NOT NULL
        REFERENCES public.leave_requests(id),

    old_status public.leave_status,
    new_status public.leave_status NOT NULL,

    changed_by UUID NOT NULL
        REFERENCES public.profiles(id),

    changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    comment TEXT
);

-- Record HR changes to annual entitlements.
CREATE TABLE public.entitlement_audit (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    user_id UUID NOT NULL
        REFERENCES public.profiles(id),

    old_entitlement INTEGER NOT NULL,
    new_entitlement INTEGER NOT NULL,

    changed_by UUID NOT NULL
        REFERENCES public.profiles(id),

    changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    comment TEXT NOT NULL
);

-- Audit records are append-only.
CREATE FUNCTION public.block_audit_changes()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    RAISE EXCEPTION 'audit_records_are_immutable';
END;
$$;

CREATE TRIGGER protect_leave_audit
BEFORE UPDATE OR DELETE ON public.leave_audit
FOR EACH ROW
EXECUTE FUNCTION public.block_audit_changes();

CREATE TRIGGER protect_entitlement_audit
BEFORE UPDATE OR DELETE ON public.entitlement_audit
FOR EACH ROW
EXECUTE FUNCTION public.block_audit_changes();


-- =========================================================
-- 3. DATABASE INDEXES
-- =========================================================

-- Efficient employee request lists.
CREATE INDEX idx_leave_user_date
ON public.leave_requests (user_id, start_date DESC);

-- Efficient department manager queues.
CREATE INDEX idx_leave_department_status
ON public.leave_requests (department_id, status, start_date);

-- Efficient lookup of pending requests.
CREATE INDEX idx_leave_pending
ON public.leave_requests (start_date)
WHERE status = 'pending';

-- Efficient audit history lookup.
CREATE INDEX idx_leave_audit_request
ON public.leave_audit (request_id, changed_at);

-- Efficient calendar date overlap queries.
CREATE INDEX idx_leave_approved_dates
ON public.leave_requests (department_id, start_date, end_date)
WHERE status = 'approved';


-- =========================================================
-- 4. WORKING DAY CALCULATION
-- =========================================================

-- Count Monday-Friday, excluding public holidays.
-- Both dates are included.
CREATE FUNCTION public.count_working_days(
    p_start DATE,
    p_end DATE
)
RETURNS INTEGER
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT count(*)::INTEGER
    FROM generate_series(
        p_start,
        p_end,
        INTERVAL '1 day'
    ) AS d(day)
    WHERE extract(isodow FROM d.day) BETWEEN 1 AND 5
      AND NOT EXISTS (
          SELECT 1
          FROM public.public_holidays h
          WHERE h.date = d.day::DATE
      );
$$;


-- =========================================================
-- 5. AUTHENTICATION HELPER FUNCTIONS
-- =========================================================

-- Safely get the current user's role.
CREATE FUNCTION public.auth_role()
RETURNS public.user_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT p.role
    FROM public.profiles p
    WHERE p.id = auth.uid();
$$;

-- Safely get the current user's department.
CREATE FUNCTION public.auth_dept()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT p.department_id
    FROM public.profiles p
    WHERE p.id = auth.uid();
$$;


-- =========================================================
-- 6. ROW LEVEL SECURITY
-- =========================================================

ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.public_holidays ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leave_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leave_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entitlement_audit ENABLE ROW LEVEL SECURITY;

-- Authenticated users can see departments.
CREATE POLICY departments_select
ON public.departments
FOR SELECT
TO authenticated
USING (true);

-- Authenticated users can see public holidays.
CREATE POLICY holidays_select
ON public.public_holidays
FOR SELECT
TO authenticated
USING (true);

-- Staff: own profile.
-- Manager: own department.
-- HR: all profiles.
CREATE POLICY profiles_select
ON public.profiles
FOR SELECT
TO authenticated
USING (
    id = auth.uid()
    OR public.auth_role() = 'hr'
    OR (
        public.auth_role() = 'manager'
        AND department_id = public.auth_dept()
    )
);

-- Staff: own requests.
-- Manager: own department.
-- HR: all requests.
CREATE POLICY leave_requests_select
ON public.leave_requests
FOR SELECT
TO authenticated
USING (
    user_id = auth.uid()
    OR public.auth_role() = 'hr'
    OR (
        public.auth_role() = 'manager'
        AND department_id = public.auth_dept()
    )
);

-- Audit visibility follows request visibility.
CREATE POLICY leave_audit_select
ON public.leave_audit
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM public.leave_requests r
        WHERE r.id = leave_audit.request_id
    )
);

-- Entitlement audit visibility:
-- HR can see all; other users see their own.
CREATE POLICY entitlement_audit_select
ON public.entitlement_audit
FOR SELECT
TO authenticated
USING (
    user_id = auth.uid()
    OR public.auth_role() = 'hr'
);

-- No INSERT, UPDATE or DELETE policies are created
-- for these application tables.
-- Browser writes must go through secure RPC functions.

REVOKE INSERT, UPDATE, DELETE
ON public.departments,
   public.profiles,
   public.public_holidays,
   public.leave_requests,
   public.leave_audit,
   public.entitlement_audit
FROM PUBLIC, anon, authenticated;

-- Grant read access; RLS further restricts visible rows.
GRANT SELECT ON
    public.departments,
    public.profiles,
    public.public_holidays,
    public.leave_requests,
    public.leave_audit,
    public.entitlement_audit
TO authenticated;


-- =========================================================
-- 7. LEAVE BALANCE FUNCTION
-- =========================================================

-- Remaining = entitlement - approved annual leave.
-- Reserved = pending annual leave.
-- Available = remaining - reserved.

CREATE FUNCTION public.leave_balance(
    p_user UUID,
    p_year INTEGER
)
RETURNS TABLE (
    entitlement INTEGER,
    used INTEGER,
    reserved INTEGER,
    remaining INTEGER,
    available INTEGER
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_profile public.profiles%ROWTYPE;
    v_used INTEGER;
    v_reserved INTEGER;
BEGIN
    IF p_year IS NULL OR p_year < 1 OR p_year > 9998 THEN
        RAISE EXCEPTION 'invalid_year';
    END IF;

    SELECT *
    INTO v_profile
    FROM public.profiles p
    WHERE p.id = p_user;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'user_not_found';
    END IF;

    IF NOT (
        p_user = auth.uid()
        OR public.auth_role() = 'hr'
        OR (
            public.auth_role() = 'manager'
            AND v_profile.department_id = public.auth_dept()
        )
    ) THEN
        RAISE EXCEPTION 'forbidden';
    END IF;

    SELECT
        coalesce(sum(r.working_days) FILTER (
            WHERE r.status = 'approved'
        ), 0)::INTEGER,
        coalesce(sum(r.working_days) FILTER (
            WHERE r.status = 'pending'
        ), 0)::INTEGER
    INTO v_used, v_reserved
    FROM public.leave_requests r
    WHERE r.user_id = p_user
      AND r.leave_type = 'annual'
      AND r.start_date >= make_date(p_year, 1, 1)
      AND r.start_date < make_date(p_year + 1, 1, 1);

    RETURN QUERY
    SELECT
        v_profile.annual_entitlement,
        v_used,
        v_reserved,
        v_profile.annual_entitlement - v_used,
        v_profile.annual_entitlement - v_used - v_reserved;
END;
$$;


-- =========================================================
-- 8. SHARED LEAVE VALIDATION
-- =========================================================

-- Internal validation used by submit and edit.
-- The caller must already lock the employee profile row.
CREATE FUNCTION public.validate_leave(
    p_user UUID,
    p_type public.leave_type,
    p_start DATE,
    p_end DATE,
    p_reason TEXT,
    p_exclude_id UUID DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_days INTEGER;
    v_entitlement INTEGER;
    v_reserved_and_used INTEGER;
BEGIN
    IF p_type IS NULL
       OR p_start IS NULL
       OR p_end IS NULL THEN
        RAISE EXCEPTION 'missing_required_fields';
    END IF;

    IF p_end < p_start THEN
        RAISE EXCEPTION 'end_before_start';
    END IF;

    IF extract(year FROM p_start)
       <> extract(year FROM p_end) THEN
        RAISE EXCEPTION 'spans_two_years';
    END IF;

    IF p_type <> 'sick' AND p_start < current_date THEN
        RAISE EXCEPTION 'start_in_past';
    END IF;

    IF p_type = 'sick'
       AND p_start < current_date - 14 THEN
        RAISE EXCEPTION 'sick_too_far_back';
    END IF;

    IF p_end > (current_date + INTERVAL '12 months')::DATE THEN
        RAISE EXCEPTION 'too_far_ahead';
    END IF;

    IF char_length(coalesce(p_reason, '')) > 1000 THEN
        RAISE EXCEPTION 'reason_too_long';
    END IF;

    IF p_type = 'unpaid'
       AND nullif(trim(coalesce(p_reason, '')), '') IS NULL THEN
        RAISE EXCEPTION 'reason_required';
    END IF;

    v_days := public.count_working_days(p_start, p_end);

    IF v_days = 0 THEN
        RAISE EXCEPTION 'no_working_days';
    END IF;

    -- Reserve available annual leave for pending requests.
    IF p_type = 'annual' THEN

        SELECT p.annual_entitlement
        INTO v_entitlement
        FROM public.profiles p
        WHERE p.id = p_user;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'user_not_found';
        END IF;

        SELECT coalesce(sum(r.working_days), 0)::INTEGER
        INTO v_reserved_and_used
        FROM public.leave_requests r
        WHERE r.user_id = p_user
          AND r.leave_type = 'annual'
          AND r.status IN ('pending', 'approved')
          AND r.start_date >= make_date(
              extract(year FROM p_start)::INTEGER, 1, 1
          )
          AND r.start_date < make_date(
              extract(year FROM p_start)::INTEGER + 1, 1, 1
          )
          AND (p_exclude_id IS NULL OR r.id <> p_exclude_id);

        IF v_reserved_and_used + v_days > v_entitlement THEN
            RAISE EXCEPTION 'insufficient_balance';
        END IF;
    END IF;

    RETURN v_days;
END;
$$;


-- =========================================================
-- 9. SUBMIT LEAVE
-- =========================================================

CREATE FUNCTION public.submit_leave(
    p_type public.leave_type,
    p_start DATE,
    p_end DATE,
    p_reason TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user UUID := auth.uid();
    v_department UUID;
    v_days INTEGER;
    v_id UUID;
BEGIN
    IF v_user IS NULL THEN
        RAISE EXCEPTION 'not_authenticated';
    END IF;

    -- Serialise this employee's leave changes.
    SELECT p.department_id
    INTO v_department
    FROM public.profiles p
    WHERE p.id = v_user
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'profile_not_found';
    END IF;

    v_days := public.validate_leave(
        v_user, p_type, p_start, p_end, p_reason, NULL
    );

    INSERT INTO public.leave_requests (
        user_id,
        department_id,
        leave_type,
        start_date,
        end_date,
        working_days,
        reason
    )
    VALUES (
        v_user,
        v_department,
        p_type,
        p_start,
        p_end,
        v_days,
        p_reason
    )
    RETURNING id INTO v_id;

    INSERT INTO public.leave_audit (
        request_id,
        old_status,
        new_status,
        changed_by
    )
    VALUES (
        v_id,
        NULL,
        'pending',
        v_user
    );

    RETURN v_id;
END;
$$;


-- =========================================================
-- 10. EDIT PENDING LEAVE
-- =========================================================

CREATE FUNCTION public.edit_leave(
    p_id UUID,
    p_type public.leave_type,
    p_start DATE,
    p_end DATE,
    p_reason TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_owner UUID;
    v_request public.leave_requests%ROWTYPE;
    v_days INTEGER;
BEGIN
    -- Identify the owner before taking locks.
    SELECT r.user_id INTO v_owner
    FROM public.leave_requests r
    WHERE r.id = p_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'not_found';
    END IF;

    IF v_owner <> auth.uid() THEN
        RAISE EXCEPTION 'forbidden';
    END IF;

    -- Lock the employee before locking their request.
    PERFORM 1
    FROM public.profiles p
    WHERE p.id = v_owner
    FOR UPDATE;

    SELECT *
    INTO v_request
    FROM public.leave_requests r
    WHERE r.id = p_id
    FOR UPDATE;

    IF NOT FOUND OR v_request.user_id <> auth.uid() THEN
        RAISE EXCEPTION 'forbidden';
    END IF;

    IF v_request.status <> 'pending' THEN
        RAISE EXCEPTION 'only_pending_can_be_edited';
    END IF;

    v_days := public.validate_leave(
        v_owner, p_type, p_start, p_end, p_reason, p_id
    );

    UPDATE public.leave_requests
    SET leave_type = p_type,
        start_date = p_start,
        end_date = p_end,
        working_days = v_days,
        reason = p_reason,
        updated_at = now()
    WHERE id = p_id;

    -- No status change: the request remains pending.
END;
$$;


-- =========================================================
-- 11. APPROVE OR REJECT LEAVE
-- =========================================================

CREATE FUNCTION public.review_leave(
    p_id UUID,
    p_decision public.leave_status,
    p_comment TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_owner UUID;
    v_request public.leave_requests%ROWTYPE;
    v_reviewer_role public.user_role;
    v_reviewer_dept UUID;
    v_requester_role public.user_role;
    v_entitlement INTEGER;
    v_used INTEGER;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'not_authenticated';
    END IF;

    IF p_decision IS NULL
       OR p_decision NOT IN ('approved', 'rejected') THEN
        RAISE EXCEPTION 'invalid_decision';
    END IF;

    IF char_length(coalesce(p_comment, '')) > 1000 THEN
        RAISE EXCEPTION 'comment_too_long';
    END IF;

    IF p_decision = 'rejected'
       AND nullif(trim(coalesce(p_comment, '')), '') IS NULL THEN
        RAISE EXCEPTION 'reason_required';
    END IF;

    SELECT p.role, p.department_id
    INTO v_reviewer_role, v_reviewer_dept
    FROM public.profiles p
    WHERE p.id = auth.uid();

    SELECT r.user_id INTO v_owner
    FROM public.leave_requests r
    WHERE r.id = p_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'not_found';
    END IF;

    IF v_owner = auth.uid() THEN
        RAISE EXCEPTION 'cannot_review_own';
    END IF;

    -- Same lock order as submit/edit/HR changes.
    SELECT p.role, p.annual_entitlement
    INTO v_requester_role, v_entitlement
    FROM public.profiles p
    WHERE p.id = v_owner
    FOR UPDATE;

    SELECT *
    INTO v_request
    FROM public.leave_requests r
    WHERE r.id = p_id
    FOR UPDATE;

    IF NOT FOUND OR v_request.user_id <> v_owner THEN
        RAISE EXCEPTION 'not_found';
    END IF;

    IF NOT (
        v_reviewer_role = 'hr'
        OR (
            v_reviewer_role = 'manager'
            AND v_request.department_id = v_reviewer_dept
            AND v_requester_role = 'staff'
        )
    ) THEN
        RAISE EXCEPTION 'forbidden';
    END IF;

    IF v_request.status <> 'pending' THEN
        RAISE EXCEPTION 'not_pending';
    END IF;

    -- Recheck annual balance within the locked transaction.
    IF p_decision = 'approved'
       AND v_request.leave_type = 'annual' THEN

        SELECT coalesce(sum(r.working_days), 0)::INTEGER
        INTO v_used
        FROM public.leave_requests r
        WHERE r.user_id = v_owner
          AND r.leave_type = 'annual'
          AND r.status = 'approved'
          AND r.start_date >= date_trunc(
              'year', v_request.start_date::TIMESTAMP
          )::DATE
          AND r.start_date < (
              date_trunc('year', v_request.start_date::TIMESTAMP)
              + INTERVAL '1 year'
          )::DATE;

        IF v_used + v_request.working_days > v_entitlement THEN
            RAISE EXCEPTION 'insufficient_balance';
        END IF;
    END IF;

    UPDATE public.leave_requests
    SET status = p_decision,
        decided_by = auth.uid(),
        decision_comment = p_comment,
        updated_at = now()
    WHERE id = p_id;

    INSERT INTO public.leave_audit (
        request_id,
        old_status,
        new_status,
        changed_by,
        comment
    )
    VALUES (
        p_id,
        'pending',
        p_decision,
        auth.uid(),
        p_comment
    );
END;
$$;


-- =========================================================
-- 12. CANCEL LEAVE
-- =========================================================

CREATE FUNCTION public.cancel_leave(
    p_id UUID,
    p_comment TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_owner UUID;
    v_request public.leave_requests%ROWTYPE;
    v_actor_role public.user_role;
    v_actor_dept UUID;
    v_owner_role public.user_role;
    v_allowed BOOLEAN := false;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'not_authenticated';
    END IF;

    IF char_length(coalesce(p_comment, '')) > 1000 THEN
        RAISE EXCEPTION 'comment_too_long';
    END IF;

    SELECT p.role, p.department_id
    INTO v_actor_role, v_actor_dept
    FROM public.profiles p
    WHERE p.id = auth.uid();

    SELECT r.user_id INTO v_owner
    FROM public.leave_requests r
    WHERE r.id = p_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'not_found';
    END IF;

    -- Lock employee first to serialize leave changes.
    SELECT p.role INTO v_owner_role
    FROM public.profiles p
    WHERE p.id = v_owner
    FOR UPDATE;

    SELECT *
    INTO v_request
    FROM public.leave_requests r
    WHERE r.id = p_id
    FOR UPDATE;

    IF NOT FOUND OR v_request.user_id <> v_owner THEN
        RAISE EXCEPTION 'not_found';
    END IF;

    -- Owners can cancel their own pending requests.
    IF v_owner = auth.uid()
       AND v_request.status = 'pending' THEN
        v_allowed := true;
    END IF;

    -- Managers can cancel their department staff's
    -- pending or approved requests, but not their own.
    IF v_actor_role = 'manager'
       AND v_owner <> auth.uid()
       AND v_owner_role = 'staff'
       AND v_request.department_id = v_actor_dept
       AND v_request.status IN ('pending', 'approved') THEN
        v_allowed := true;
    END IF;

    -- HR can cancel other users' pending/approved leave.
    IF v_actor_role = 'hr'
       AND v_owner <> auth.uid()
       AND v_request.status IN ('pending', 'approved') THEN
        v_allowed := true;
    END IF;

    IF NOT v_allowed THEN
        RAISE EXCEPTION 'cannot_cancel_request';
    END IF;

    UPDATE public.leave_requests
    SET status = 'cancelled',
        updated_at = now()
    WHERE id = p_id;

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
$$;


-- =========================================================
-- 13. HR: ADJUST ANNUAL LEAVE ENTITLEMENT
-- =========================================================

-- Only HR may assign/change an employee's entitlement.
-- The adjustment must never invalidate already used or
-- reserved annual leave in any year represented in data.

CREATE FUNCTION public.set_annual_entitlement(
    p_user UUID,
    p_entitlement INTEGER,
    p_comment TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_old INTEGER;
    v_max_committed INTEGER;
BEGIN
    IF public.auth_role() IS DISTINCT FROM 'hr' THEN
        RAISE EXCEPTION 'hr_only';
    END IF;

    IF p_entitlement IS NULL OR p_entitlement < 0 THEN
        RAISE EXCEPTION 'invalid_entitlement';
    END IF;

    IF nullif(trim(coalesce(p_comment, '')), '') IS NULL THEN
        RAISE EXCEPTION 'reason_required';
    END IF;

    IF char_length(p_comment) > 1000 THEN
        RAISE EXCEPTION 'comment_too_long';
    END IF;

    -- Serialize entitlement changes with leave actions.
    SELECT p.annual_entitlement INTO v_old
    FROM public.profiles p
    WHERE p.id = p_user
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'user_not_found';
    END IF;

    -- Find highest annual leave commitment in any year.
    SELECT coalesce(max(year_total), 0)::INTEGER
    INTO v_max_committed
    FROM (
        SELECT sum(r.working_days) AS year_total
        FROM public.leave_requests r
        WHERE r.user_id = p_user
          AND r.leave_type = 'annual'
          AND r.status IN ('pending', 'approved')
        GROUP BY extract(year FROM r.start_date)
    ) totals;

    IF p_entitlement < v_max_committed THEN
        RAISE EXCEPTION 'entitlement_below_committed_leave';
    END IF;

    IF p_entitlement = v_old THEN
        RETURN;
    END IF;

    UPDATE public.profiles
    SET annual_entitlement = p_entitlement
    WHERE id = p_user;

    INSERT INTO public.entitlement_audit (
        user_id,
        old_entitlement,
        new_entitlement,
        changed_by,
        comment
    )
    VALUES (
        p_user,
        v_old,
        p_entitlement,
        auth.uid(),
        p_comment
    );
END;
$$;


-- =========================================================
-- 14. TEAM CALENDAR
-- =========================================================

-- Managers see only their department.
-- HR can select a department company-wide.
CREATE FUNCTION public.team_calendar(
    p_month DATE,
    p_department UUID DEFAULT NULL
)
RETURNS TABLE (
    request_id UUID,
    employee_id UUID,
    employee_name TEXT,
    leave_type public.leave_type,
    start_date DATE,
    end_date DATE
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_department UUID;
    v_month_start DATE;
    v_month_end DATE;
BEGIN
    IF p_month IS NULL THEN
        RAISE EXCEPTION 'month_required';
    END IF;

    IF public.auth_role() = 'manager' THEN
        v_department := public.auth_dept();

        IF p_department IS NOT NULL
           AND p_department <> v_department THEN
            RAISE EXCEPTION 'forbidden';
        END IF;

    ELSIF public.auth_role() = 'hr' THEN
        v_department := coalesce(
            p_department,
            public.auth_dept()
        );
    ELSE
        RAISE EXCEPTION 'forbidden';
    END IF;

    v_month_start := date_trunc(
        'month', p_month::TIMESTAMP
    )::DATE;

    v_month_end := (
        v_month_start + INTERVAL '1 month'
    )::DATE;

    RETURN QUERY
    SELECT
        r.id,
        r.user_id,
        p.full_name,
        r.leave_type,
        r.start_date,
        r.end_date
    FROM public.leave_requests r
    JOIN public.profiles p ON p.id = r.user_id
    WHERE r.department_id = v_department
      AND r.status = 'approved'
      AND r.start_date < v_month_end
      AND r.end_date >= v_month_start
    ORDER BY p.full_name, r.start_date;
END;
$$;


-- =========================================================
-- 15. FUNCTION EXECUTION PERMISSIONS
-- =========================================================

-- PostgreSQL functions normally allow PUBLIC execution.
-- Remove that default before selectively granting access.

REVOKE ALL ON FUNCTION public.block_audit_changes()
FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.auth_role()
FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.auth_dept()
FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.count_working_days(DATE, DATE)
FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.leave_balance(UUID, INTEGER)
FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.validate_leave(
    UUID, public.leave_type, DATE, DATE, TEXT, UUID
)
FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.submit_leave(
    public.leave_type, DATE, DATE, TEXT
)
FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.edit_leave(
    UUID, public.leave_type, DATE, DATE, TEXT
)
FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.review_leave(
    UUID, public.leave_status, TEXT
)
FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.cancel_leave(UUID, TEXT)
FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.set_annual_entitlement(
    UUID, INTEGER, TEXT
)
FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.team_calendar(DATE, UUID)
FROM PUBLIC, anon, authenticated;

-- Only signed-in users can call approved public functions.
GRANT EXECUTE ON FUNCTION public.auth_role()
TO authenticated;

GRANT EXECUTE ON FUNCTION public.auth_dept()
TO authenticated;

GRANT EXECUTE ON FUNCTION public.count_working_days(DATE, DATE)
TO authenticated;

GRANT EXECUTE ON FUNCTION public.leave_balance(UUID, INTEGER)
TO authenticated;

GRANT EXECUTE ON FUNCTION public.submit_leave(
    public.leave_type, DATE, DATE, TEXT
)
TO authenticated;

GRANT EXECUTE ON FUNCTION public.edit_leave(
    UUID, public.leave_type, DATE, DATE, TEXT
)
TO authenticated;

GRANT EXECUTE ON FUNCTION public.review_leave(
    UUID, public.leave_status, TEXT
)
TO authenticated;

GRANT EXECUTE ON FUNCTION public.cancel_leave(UUID, TEXT)
TO authenticated;

GRANT EXECUTE ON FUNCTION public.set_annual_entitlement(
    UUID, INTEGER, TEXT
)
TO authenticated;

GRANT EXECUTE ON FUNCTION public.team_calendar(DATE, UUID)
TO authenticated;
