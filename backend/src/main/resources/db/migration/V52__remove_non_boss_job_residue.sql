DELETE FROM job_positions
WHERE id IN (
    '08320b4b-350d-417c-946c-17a9d9b37435',
    'd5f1fd3b-8dd1-44b2-a3b3-60126c4ab877',
    '040a5a95-0831-4e5b-97af-4540dc5c1188'
)
  AND status = 'CLOSED'
  AND capture_source <> 'VISIBLE_PAGE'
  AND NOT EXISTS (
      SELECT 1 FROM candidate_job_contacts contact WHERE contact.job_position_id = job_positions.id
  )
  AND NOT EXISTS (
      SELECT 1 FROM ai_assistance_runs run WHERE run.job_position_id = job_positions.id
  )
  AND NOT EXISTS (
      SELECT 1 FROM local_connector_unread_observations observation
      WHERE observation.manual_match_job_position_id = job_positions.id
  );
