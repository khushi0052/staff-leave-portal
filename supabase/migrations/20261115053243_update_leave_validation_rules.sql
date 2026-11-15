
CREATE OR REPLACE FUNCTION public.validate_leave(
    p_user uuid,
    p_type public.leave_type,
    p_start date,
    p_end date,
    p_reason text,
    p_exclude_id uuid DEFAULT NULL::uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_days INTEGER;
    v_entitlement INTEGER;
    v_reserved_and_used INTEGER;
BEGIN
    -- ============================================
    -- 1. REQUIRED FIELDS
    -- ============================================

    IF p_type IS NULL
       OR p_start IS NULL
       OR p_end IS NULL THEN
        RAISE EXCEPTION 'missing_required_fields';
    END IF;

    -- ============================================
    -- 2. DATE ORDER
    -- ============================================

    IF p_end < p_start THEN
        RAISE EXCEPTION 'end_before_start';
    END IF;

    -- ============================================
    -- 3. NO CROSS-YEAR REQUESTS
    -- ============================================

    IF EXTRACT(YEAR FROM p_start)
       <> EXTRACT(YEAR FROM p_end) THEN
        RAISE EXCEPTION 'spans_two_years';
    END IF;

    -- ============================================
    -- 4. ANNUAL AND UNPAID: NO PAST START DATES
    -- ============================================

    IF p_type <> 'sick'
       AND p_start < CURRENT_DATE THEN
        RAISE EXCEPTION 'start_in_past';
    END IF;

    -- ============================================
    -- 5. SICK LEAVE: UP TO 10 DAYS BACKDATED
    -- ============================================

    IF p_type = 'sick'
       AND p_start < CURRENT_DATE - 10 THEN
        RAISE EXCEPTION 'sick_too_far_back';
    END IF;

    -- ============================================
    -- 6. ANNUAL LEAVE: MAXIMUM 12 MONTHS AHEAD
    -- ============================================

    IF p_type = 'annual'
       AND p_end > (
           CURRENT_DATE + INTERVAL '12 months'
       )::date THEN
        RAISE EXCEPTION 'too_far_ahead';
    END IF;

    -- ============================================
    -- 7. SICK AND UNPAID: MAXIMUM 12 MONTHS AHEAD
    -- ============================================

    IF p_type IN ('sick', 'unpaid')
       AND p_end > (
           CURRENT_DATE + INTERVAL '12 months'
       )::date THEN
        RAISE EXCEPTION 'too_far_ahead';
    END IF;

    -- ============================================
    -- 8. REASON LENGTH AND REQUIREMENTS
    -- ============================================

    IF CHAR_LENGTH(COALESCE(p_reason, '')) > 1000 THEN
        RAISE EXCEPTION 'reason_too_long';
    END IF;

    -- Only Unpaid leave requires a reason.
    IF p_type = 'unpaid'
       AND NULLIF(TRIM(COALESCE(p_reason, '')), '') IS NULL THEN
        RAISE EXCEPTION 'reason_required';
    END IF;

    -- ============================================
    -- 9. WORKING DAYS
    -- ============================================

    -- Count weekdays excluding public holidays.
    v_days := public.count_working_days(
        p_start,
        p_end
    );

    IF v_days IS NULL OR v_days <= 0 THEN
        RAISE EXCEPTION 'no_working_days';
    END IF;

    -- ============================================
    -- 10. ANNUAL LEAVE ENTITLEMENT
    -- ============================================

    -- Sick and Unpaid leave skip this section.
    IF p_type = 'annual' THEN

        -- Read the entitlement assigned by HR.
        SELECT p.annual_entitlement
        INTO v_entitlement
        FROM public.profiles p
        WHERE p.id = p_user;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'user_not_found';
        END IF;

        -- HR must assign entitlement explicitly.
        IF v_entitlement IS NULL THEN
            RAISE EXCEPTION 'annual_entitlement_not_assigned';
        END IF;

        -- Count Approved and Pending Annual leave
        -- in the requested calendar year.
        SELECT COALESCE(
            SUM(r.working_days), 0
        )::integer
        INTO v_reserved_and_used
        FROM public.leave_requests r
        WHERE r.user_id = p_user
          AND r.leave_type = 'annual'
          AND r.status IN ('pending', 'approved')
          AND r.start_date >= MAKE_DATE(
              EXTRACT(YEAR FROM p_start)::integer,
              1,
              1
          )
          AND r.start_date < MAKE_DATE(
              EXTRACT(YEAR FROM p_start)::integer + 1,
              1,
              1
          )
          AND (
              p_exclude_id IS NULL
              OR r.id <> p_exclude_id
          );

        -- Prevent exceeding HR-assigned entitlement.
        IF v_reserved_and_used + v_days
           > v_entitlement THEN
            RAISE EXCEPTION 'insufficient_balance';
        END IF;

    END IF;

    -- ============================================
    -- 11. RETURN VALIDATED WORKING DAYS
    -- ============================================

    RETURN v_days;
END;
$function$;
