ALTER TABLE resume_intakes
    ADD COLUMN source_event_digest CHAR(64);

CREATE UNIQUE INDEX uq_resume_intake_contact_source_event
    ON resume_intakes(contact_id, source_event_digest)
    WHERE source_event_digest IS NOT NULL;
