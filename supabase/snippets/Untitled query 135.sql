SELECT
  COUNT(*) AS demo_records,
  COUNT(*) FILTER (
    WHERE status = 'approved'
  ) AS approved,
  COUNT(*) FILTER (
    WHERE status = 'rejected'
  ) AS rejected,
  COUNT(*) FILTER (
    WHERE status = 'cancelled'
  ) AS cancelled,
  COUNT(*) FILTER (
    WHERE status = 'pending'
  ) AS pending
FROM public.leave_requests
WHERE reason LIKE '%DEMO_HISTORY_V1%';