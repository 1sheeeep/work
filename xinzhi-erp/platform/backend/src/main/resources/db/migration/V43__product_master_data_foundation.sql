ALTER TABLE tenant_product_spus
    ADD COLUMN name_zh VARCHAR(200),
    ADD COLUMN name_en VARCHAR(200),
    ADD COLUMN product_note VARCHAR(2000),
    ADD COLUMN sensitive_attributes_revision BIGINT NOT NULL DEFAULT 0;

UPDATE tenant_product_spus
SET name_zh = name;

CREATE FUNCTION sync_product_spu_names()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.name_zh IS NULL THEN
            NEW.name_zh := NEW.name;
        ELSIF NEW.name IS DISTINCT FROM NEW.name_zh THEN
            RAISE EXCEPTION 'product SPU name and name_zh must match';
        END IF;
    ELSIF NEW.name IS DISTINCT FROM OLD.name
            AND NEW.name_zh IS NOT DISTINCT FROM OLD.name_zh THEN
        NEW.name_zh := NEW.name;
    ELSIF NEW.name_zh IS DISTINCT FROM OLD.name_zh
            AND NEW.name IS NOT DISTINCT FROM OLD.name THEN
        NEW.name := NEW.name_zh;
    ELSIF NEW.name IS DISTINCT FROM NEW.name_zh THEN
        RAISE EXCEPTION 'product SPU name and name_zh must match';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_tenant_product_spus_sync_names
    BEFORE INSERT OR UPDATE OF name, name_zh
    ON tenant_product_spus
    FOR EACH ROW
    EXECUTE FUNCTION sync_product_spu_names();

ALTER TABLE tenant_product_spus
    ALTER COLUMN name_zh SET NOT NULL,
    ADD CONSTRAINT ck_tenant_product_spus_name_zh
        CHECK (char_length(btrim(name_zh)) > 0),
    ADD CONSTRAINT ck_tenant_product_spus_name_en_trimmed
        CHECK (name_en IS NULL OR name_en = btrim(name_en)),
    ADD CONSTRAINT ck_tenant_product_spus_product_note_trimmed
        CHECK (product_note IS NULL OR product_note = btrim(product_note)),
    ADD CONSTRAINT ck_tenant_product_spus_sensitive_attributes_revision
        CHECK (sensitive_attributes_revision >= 0);

CREATE TABLE tenant_product_spu_sensitive_attributes (
    tenant_id UUID NOT NULL,
    spu_id UUID NOT NULL,
    attribute_code VARCHAR(40) NOT NULL,
    sort_order SMALLINT NOT NULL,
    CONSTRAINT pk_tenant_product_spu_sensitive_attributes
        PRIMARY KEY (tenant_id, spu_id, attribute_code),
    CONSTRAINT uq_tenant_product_spu_sensitive_attributes_order
        UNIQUE (tenant_id, spu_id, sort_order),
    CONSTRAINT fk_tenant_product_spu_sensitive_attributes_spu
        FOREIGN KEY (tenant_id, spu_id)
        REFERENCES tenant_product_spus (tenant_id, id),
    CONSTRAINT ck_tenant_product_spu_sensitive_attributes_code_order
        CHECK (
            (attribute_code = 'BATTERY' AND sort_order = 0)
            OR (attribute_code = 'INFRINGEMENT' AND sort_order = 1)
            OR (attribute_code = 'MAGNETIC' AND sort_order = 2)
            OR (attribute_code = 'COSMETIC_NON_LIQUID' AND sort_order = 3)
            OR (attribute_code = 'COSMETIC_LIQUID' AND sort_order = 4)
            OR (attribute_code = 'LIQUID_NON_COSMETIC' AND sort_order = 5)
            OR (attribute_code = 'POWDER' AND sort_order = 6)
            OR (attribute_code = 'PASTE' AND sort_order = 7)
            OR (attribute_code = 'BLADED_ITEM' AND sort_order = 8)
            OR (attribute_code = 'FLAMMABLE' AND sort_order = 9)
        )
);
