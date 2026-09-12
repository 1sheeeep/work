ALTER TABLE candidate_profiles
    ADD COLUMN IF NOT EXISTS merged_into_id UUID REFERENCES candidate_profiles(id),
    ADD COLUMN IF NOT EXISTS merged_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS merged_by UUID REFERENCES system_users(id);

CREATE INDEX IF NOT EXISTS idx_candidate_profiles_merged_into
    ON candidate_profiles(merged_into_id)
    WHERE merged_into_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS candidate_merge_operations (
    id UUID PRIMARY KEY,
    company_id UUID NOT NULL REFERENCES companies(id),
    primary_candidate_id UUID NOT NULL REFERENCES candidate_profiles(id),
    merged_by UUID NOT NULL REFERENCES system_users(id),
    status VARCHAR(16) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    undone_at TIMESTAMPTZ,
    undone_by UUID REFERENCES system_users(id),
    CONSTRAINT ck_candidate_merge_status CHECK (status IN ('ACTIVE', 'UNDONE'))
);

CREATE TABLE IF NOT EXISTS candidate_merge_items (
    id UUID PRIMARY KEY,
    operation_id UUID NOT NULL REFERENCES candidate_merge_operations(id),
    source_candidate_id UUID NOT NULL REFERENCES candidate_profiles(id),
    target_candidate_id UUID NOT NULL REFERENCES candidate_profiles(id),
    CONSTRAINT uq_candidate_merge_item UNIQUE (operation_id, source_candidate_id)
);

CREATE INDEX IF NOT EXISTS idx_candidate_merge_items_source ON candidate_merge_items(source_candidate_id);
