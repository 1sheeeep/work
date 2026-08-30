DELETE FROM job_positions
WHERE capture_source <> 'VISIBLE_PAGE'
  AND NOT EXISTS (
      SELECT 1 FROM candidate_job_contacts contact
      WHERE contact.job_position_id = job_positions.id
  )
  AND NOT EXISTS (
      SELECT 1 FROM ai_assistance_runs run
      WHERE run.job_position_id = job_positions.id
  )
  AND NOT EXISTS (
      SELECT 1 FROM local_connector_unread_observations observation
      WHERE observation.manual_match_job_position_id = job_positions.id
         OR observation.matched_job_position_id = job_positions.id
  );
