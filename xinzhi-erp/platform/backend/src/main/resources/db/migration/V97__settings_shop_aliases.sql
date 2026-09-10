CREATE TABLE tenant_shop_aliases (
    shop_id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    alias_en VARCHAR(160),
    alias_zh_cn VARCHAR(160),
    alias_es VARCHAR(160),
    alias_id VARCHAR(160),
    alias_th VARCHAR(160),
    alias_ru VARCHAR(160),
    alias_pt VARCHAR(160),
    alias_vi VARCHAR(160),
    alias_ms VARCHAR(160),
    updated_by_display_name VARCHAR(160) NOT NULL,
    created_by_user_id UUID,
    created_by_system_admin_id UUID REFERENCES system_admins(id),
    updated_by_user_id UUID,
    updated_by_system_admin_id UUID REFERENCES system_admins(id),
    request_id VARCHAR(100) NOT NULL,
    version BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_shop_alias_tenant_shop UNIQUE (tenant_id, shop_id),
    CONSTRAINT fk_shop_alias_shop FOREIGN KEY (tenant_id, shop_id)
        REFERENCES tenant_shops (tenant_id, id),
    CONSTRAINT fk_shop_alias_created_user
        FOREIGN KEY (created_by_user_id, tenant_id) REFERENCES users (id, tenant_id),
    CONSTRAINT fk_shop_alias_updated_user
        FOREIGN KEY (updated_by_user_id, tenant_id) REFERENCES users (id, tenant_id),
    CONSTRAINT ck_shop_alias_values CHECK (
        (alias_en IS NULL OR (alias_en = btrim(alias_en) AND char_length(alias_en) BETWEEN 1 AND 160 AND alias_en !~ '[[:cntrl:]]'))
        AND (alias_zh_cn IS NULL OR (alias_zh_cn = btrim(alias_zh_cn) AND char_length(alias_zh_cn) BETWEEN 1 AND 160 AND alias_zh_cn !~ '[[:cntrl:]]'))
        AND (alias_es IS NULL OR (alias_es = btrim(alias_es) AND char_length(alias_es) BETWEEN 1 AND 160 AND alias_es !~ '[[:cntrl:]]'))
        AND (alias_id IS NULL OR (alias_id = btrim(alias_id) AND char_length(alias_id) BETWEEN 1 AND 160 AND alias_id !~ '[[:cntrl:]]'))
        AND (alias_th IS NULL OR (alias_th = btrim(alias_th) AND char_length(alias_th) BETWEEN 1 AND 160 AND alias_th !~ '[[:cntrl:]]'))
        AND (alias_ru IS NULL OR (alias_ru = btrim(alias_ru) AND char_length(alias_ru) BETWEEN 1 AND 160 AND alias_ru !~ '[[:cntrl:]]'))
        AND (alias_pt IS NULL OR (alias_pt = btrim(alias_pt) AND char_length(alias_pt) BETWEEN 1 AND 160 AND alias_pt !~ '[[:cntrl:]]'))
        AND (alias_vi IS NULL OR (alias_vi = btrim(alias_vi) AND char_length(alias_vi) BETWEEN 1 AND 160 AND alias_vi !~ '[[:cntrl:]]'))
        AND (alias_ms IS NULL OR (alias_ms = btrim(alias_ms) AND char_length(alias_ms) BETWEEN 1 AND 160 AND alias_ms !~ '[[:cntrl:]]'))
    ),
    CONSTRAINT ck_shop_alias_actors CHECK (
        (created_by_user_id IS NULL) <> (created_by_system_admin_id IS NULL)
        AND (updated_by_user_id IS NULL) <> (updated_by_system_admin_id IS NULL)
    ),
    CONSTRAINT ck_shop_alias_display_name CHECK (
        updated_by_display_name = btrim(updated_by_display_name)
        AND char_length(updated_by_display_name) BETWEEN 1 AND 160
        AND updated_by_display_name !~ '[[:cntrl:]]'
    ),
    CONSTRAINT ck_shop_alias_request CHECK (request_id ~ '^[A-Za-z0-9._:-]{1,100}$'),
    CONSTRAINT ck_shop_alias_version CHECK (version >= 0),
    CONSTRAINT ck_shop_alias_timestamps CHECK (updated_at >= created_at)
);

CREATE INDEX ix_shop_alias_tenant_updated
    ON tenant_shop_aliases (tenant_id, updated_at DESC, shop_id);
