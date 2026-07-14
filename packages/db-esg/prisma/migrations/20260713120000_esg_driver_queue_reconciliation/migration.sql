-- Convert pre-durable-queue ESG Driver rows into an explicit, reconcilable
-- lifecycle. An orphaned active row cannot be resumed because it has no lease
-- or attempt history, so fail it clearly and let the user retry or delete it.
UPDATE esg_driver_jobs AS domain
SET status = 'error',
    progress = 100,
    stage = 'error',
    error_message = COALESCE(
      domain.error_message,
      'Legacy job could not be resumed after the durable worker upgrade. Generate it again.'
    ),
    completed_at = COALESCE(domain.completed_at, now()),
    updated_at = now()
WHERE domain.user_id IS NOT NULL
  AND domain.status IN ('queued', 'processing')
  AND NOT EXISTS (
    SELECT 1 FROM background_jobs AS queue WHERE queue.id = domain.id
  );

INSERT INTO background_jobs (
  id,
  job_type,
  user_id,
  payload_json,
  result_json,
  status,
  progress,
  max_attempts,
  available_at,
  idempotency_key,
  last_error,
  created_at,
  updated_at,
  completed_at
)
SELECT
  domain.id,
  'esg_driver',
  domain.user_id,
  jsonb_build_object(
    'country', domain.country,
    'sector', domain.sector,
    'language', domain.language
  ),
  CASE
    WHEN domain.status = 'done' AND domain.result_json IS NOT NULL
      THEN jsonb_build_object(
        'generatedDrivers', CASE
          WHEN jsonb_typeof(domain.result_json -> 'drivers') = 'array'
            THEN jsonb_array_length(domain.result_json -> 'drivers')
          ELSE 0
        END,
        'reconciled', true
      )
    ELSE NULL
  END,
  CASE
    WHEN domain.status IN ('done', 'error', 'cancelled') THEN domain.status
    ELSE 'error'
  END,
  CASE WHEN domain.status IN ('done', 'error', 'cancelled') THEN 100 ELSE domain.progress END,
  2,
  COALESCE(domain.created_at, now()),
  'esg_driver:' || domain.id::text,
  domain.error_message,
  COALESCE(domain.created_at, now()),
  COALESCE(domain.updated_at, now()),
  COALESCE(domain.completed_at, now())
FROM esg_driver_jobs AS domain
WHERE domain.user_id IS NOT NULL
ON CONFLICT (id) DO NOTHING;

-- Mirror queue-terminal failures into domain rows that were left active by the
-- former two-step worker transition.
UPDATE esg_driver_jobs AS domain
SET status = queue.status,
    progress = 100,
    stage = queue.status,
    error_message = CASE
      WHEN queue.status = 'error'
        THEN COALESCE(queue.last_error, 'ESG driver generation failed.')
      ELSE NULL
    END,
    completed_at = COALESCE(queue.completed_at, domain.completed_at, now()),
    updated_at = now()
FROM background_jobs AS queue
WHERE queue.id = domain.id
  AND queue.job_type = 'esg_driver'
  AND queue.status IN ('error', 'cancelled')
  AND domain.status IN ('queued', 'processing');

-- A queue completion is valid only when the durable driver result exists.
UPDATE esg_driver_jobs AS domain
SET status = 'done',
    progress = 100,
    stage = 'complete',
    error_message = NULL,
    completed_at = COALESCE(queue.completed_at, domain.completed_at, now()),
    updated_at = now()
FROM background_jobs AS queue
WHERE queue.id = domain.id
  AND queue.job_type = 'esg_driver'
  AND queue.status = 'done'
  AND domain.status IN ('queued', 'processing')
  AND domain.result_json IS NOT NULL;

UPDATE esg_driver_jobs AS domain
SET status = 'error',
    progress = 100,
    stage = 'error',
    error_message = COALESCE(
      domain.error_message,
      'Completed queue record has no durable ESG driver result. Generate it again.'
    ),
    completed_at = COALESCE(queue.completed_at, domain.completed_at, now()),
    updated_at = now()
FROM background_jobs AS queue
WHERE queue.id = domain.id
  AND queue.job_type = 'esg_driver'
  AND queue.status = 'done'
  AND domain.status IN ('queued', 'processing', 'done')
  AND domain.result_json IS NULL;

-- Repair lifecycle mismatches left by the former two-step completion path.
UPDATE background_jobs AS queue
SET status = domain.status,
    progress = 100,
    result_json = CASE
      WHEN domain.status = 'done' AND domain.result_json IS NOT NULL
        THEN jsonb_build_object(
          'generatedDrivers', CASE
            WHEN jsonb_typeof(domain.result_json -> 'drivers') = 'array'
              THEN jsonb_array_length(domain.result_json -> 'drivers')
            ELSE 0
          END,
          'reconciled', true
        )
      ELSE queue.result_json
    END,
    last_error = CASE WHEN domain.status = 'error' THEN domain.error_message ELSE queue.last_error END,
    lease_owner = NULL,
    lease_expires_at = NULL,
    completed_at = COALESCE(domain.completed_at, now()),
    updated_at = now()
FROM esg_driver_jobs AS domain
WHERE queue.id = domain.id
  AND queue.job_type = 'esg_driver'
  AND domain.status IN ('done', 'error', 'cancelled')
  AND queue.status <> domain.status;
