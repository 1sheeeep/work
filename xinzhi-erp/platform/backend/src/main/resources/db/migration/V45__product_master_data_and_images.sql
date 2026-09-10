-- Tenant product master data, governed SPU references, and local image metadata.
-- V44 is allocated to the inventory bounded context and is intentionally absent.

CREATE TABLE tenant_product_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    name VARCHAR(200) NOT NULL,
    sort_order INTEGER NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    version BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT uq_tenant_product_categories_tenant_id
        UNIQUE (tenant_id, id),
    CONSTRAINT ck_tenant_product_categories_name
        CHECK (name = btrim(name) AND char_length(name) BETWEEN 1 AND 200),
    CONSTRAINT ck_tenant_product_categories_sort_order
        CHECK (sort_order BETWEEN 0 AND 1000000),
    CONSTRAINT ck_tenant_product_categories_status
        CHECK (status IN ('ACTIVE', 'INACTIVE', 'ARCHIVED')),
    CONSTRAINT ck_tenant_product_categories_version
        CHECK (version >= 0),
    CONSTRAINT ck_tenant_product_categories_timestamps
        CHECK (updated_at >= created_at)
);

CREATE UNIQUE INDEX uq_tenant_product_categories_normalized_name
    ON tenant_product_categories (tenant_id, lower(btrim(name)));
CREATE INDEX idx_tenant_product_categories_list
    ON tenant_product_categories (
        tenant_id, status, sort_order, lower(name), id
    );

CREATE FUNCTION seed_default_product_categories(target_tenant_id UUID)
RETURNS void
LANGUAGE sql
AS $$
    INSERT INTO tenant_product_categories (
        tenant_id, name, sort_order
    )
    SELECT target_tenant_id, seed.name, seed.sort_order
    FROM (VALUES
        ('家居类', 10),
        ('化妆类', 20),
        ('穿戴类', 30),
        ('汽车用品', 40),
        ('运动类', 50),
        ('书籍类', 60),
        ('家电类', 70),
        ('物流费用', 80),
        ('玩具类', 90),
        ('服装类', 100),
        ('文体类', 110),
        ('包材类', 120),
        ('工具类', 130),
        ('食品类', 140),
        ('数码类', 150),
        ('速卖', 160),
        ('日用类', 170),
        ('种植类', 180),
        ('厨具', 190)
    ) AS seed(name, sort_order)
    ON CONFLICT DO NOTHING;
$$;

SELECT seed_default_product_categories(tenant.id)
FROM tenants tenant;

CREATE FUNCTION seed_default_product_categories_after_tenant_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    PERFORM seed_default_product_categories(NEW.id);
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_tenants_seed_default_product_categories
AFTER INSERT ON tenants
FOR EACH ROW EXECUTE FUNCTION
    seed_default_product_categories_after_tenant_insert();

CREATE TABLE tenant_product_package_materials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    name VARCHAR(200) NOT NULL,
    unit_price NUMERIC(14, 4),
    currency_code VARCHAR(3),
    weight_grams BIGINT,
    package_level INTEGER,
    length_mm BIGINT,
    width_mm BIGINT,
    height_mm BIGINT,
    status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE',
    created_by_type VARCHAR(24) NOT NULL,
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    version BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT uq_tenant_product_package_materials_tenant_id
        UNIQUE (tenant_id, id),
    CONSTRAINT ck_tenant_product_package_materials_name
        CHECK (name = btrim(name) AND char_length(name) BETWEEN 1 AND 200),
    CONSTRAINT ck_tenant_product_package_materials_price_currency
        CHECK (
            (unit_price IS NULL AND currency_code IS NULL)
            OR (
                unit_price BETWEEN 0 AND 9999999999.9999
                AND currency_code ~ '^[A-Z]{3}$'
            )
        ),
    CONSTRAINT ck_tenant_product_package_materials_weight
        CHECK (
            weight_grams IS NULL
            OR weight_grams BETWEEN 1 AND 1000000000
        ),
    CONSTRAINT ck_tenant_product_package_materials_level
        CHECK (
            package_level IS NULL
            OR package_level BETWEEN 1 AND 100
        ),
    CONSTRAINT ck_tenant_product_package_materials_length
        CHECK (length_mm IS NULL OR length_mm BETWEEN 1 AND 1000000),
    CONSTRAINT ck_tenant_product_package_materials_width
        CHECK (width_mm IS NULL OR width_mm BETWEEN 1 AND 1000000),
    CONSTRAINT ck_tenant_product_package_materials_height
        CHECK (height_mm IS NULL OR height_mm BETWEEN 1 AND 1000000),
    CONSTRAINT ck_tenant_product_package_materials_status
        CHECK (status IN ('ACTIVE', 'INACTIVE', 'ARCHIVED')),
    CONSTRAINT ck_tenant_product_package_materials_created_by
        CHECK (created_by_type IN ('TENANT_USER', 'SYSTEM_ADMIN')),
    CONSTRAINT ck_tenant_product_package_materials_version
        CHECK (version >= 0),
    CONSTRAINT ck_tenant_product_package_materials_timestamps
        CHECK (updated_at >= created_at)
);

CREATE UNIQUE INDEX uq_tenant_product_package_materials_normalized_name
    ON tenant_product_package_materials (tenant_id, lower(btrim(name)));
CREATE INDEX idx_tenant_product_package_materials_list
    ON tenant_product_package_materials (
        tenant_id, status, lower(name), id
    );

ALTER TABLE tenant_product_spus
    ADD COLUMN category_id UUID,
    ADD COLUMN category_name_snapshot VARCHAR(200),
    ADD COLUMN length_mm BIGINT,
    ADD COLUMN width_mm BIGINT,
    ADD COLUMN height_mm BIGINT,
    ADD COLUMN actual_weight_grams BIGINT,
    ADD COLUMN volumetric_divisor INTEGER NOT NULL DEFAULT 5000,
    ADD COLUMN package_material_id UUID,
    ADD COLUMN package_material_name_snapshot VARCHAR(200),
    ADD COLUMN packageable_count INTEGER,
    ADD COLUMN art_member_id UUID,
    ADD COLUMN art_member_name_snapshot VARCHAR(160),
    ADD COLUMN developer_member_id UUID,
    ADD COLUMN developer_member_name_snapshot VARCHAR(160),
    ADD COLUMN developer_assistant_member_id UUID,
    ADD COLUMN developer_assistant_member_name_snapshot VARCHAR(160),
    ADD COLUMN sales_member_id UUID,
    ADD COLUMN sales_member_name_snapshot VARCHAR(160);

UPDATE tenant_product_spus
SET product_note = btrim(description)
WHERE nullif(btrim(description), '') IS NOT NULL
  AND nullif(btrim(product_note), '') IS NULL;

ALTER TABLE tenant_product_spus
    DROP COLUMN description,
    ADD CONSTRAINT fk_tenant_product_spus_category
        FOREIGN KEY (tenant_id, category_id)
        REFERENCES tenant_product_categories (tenant_id, id),
    ADD CONSTRAINT fk_tenant_product_spus_package_material
        FOREIGN KEY (tenant_id, package_material_id)
        REFERENCES tenant_product_package_materials (tenant_id, id),
    ADD CONSTRAINT fk_tenant_product_spus_art_member
        FOREIGN KEY (art_member_id, tenant_id)
        REFERENCES users (id, tenant_id),
    ADD CONSTRAINT fk_tenant_product_spus_developer_member
        FOREIGN KEY (developer_member_id, tenant_id)
        REFERENCES users (id, tenant_id),
    ADD CONSTRAINT fk_tenant_product_spus_developer_assistant_member
        FOREIGN KEY (developer_assistant_member_id, tenant_id)
        REFERENCES users (id, tenant_id),
    ADD CONSTRAINT fk_tenant_product_spus_sales_member
        FOREIGN KEY (sales_member_id, tenant_id)
        REFERENCES users (id, tenant_id),
    ADD CONSTRAINT ck_tenant_product_spus_category_snapshot
        CHECK (
            (category_id IS NULL) =
            (category_name_snapshot IS NULL)
        ),
    ADD CONSTRAINT ck_tenant_product_spus_dimensions
        CHECK (
            (
                length_mm IS NULL
                AND width_mm IS NULL
                AND height_mm IS NULL
            )
            OR (
                length_mm BETWEEN 1 AND 1000000
                AND width_mm BETWEEN 1 AND 1000000
                AND height_mm BETWEEN 1 AND 1000000
            )
        ),
    ADD CONSTRAINT ck_tenant_product_spus_actual_weight
        CHECK (
            actual_weight_grams IS NULL
            OR actual_weight_grams BETWEEN 1 AND 1000000000
        ),
    ADD CONSTRAINT ck_tenant_product_spus_volumetric_divisor
        CHECK (volumetric_divisor IN (5000, 6000)),
    ADD CONSTRAINT ck_tenant_product_spus_package_material
        CHECK (
            (
                package_material_id IS NULL
                AND package_material_name_snapshot IS NULL
                AND packageable_count IS NULL
            )
            OR (
                package_material_id IS NOT NULL
                AND package_material_name_snapshot IS NOT NULL
                AND packageable_count BETWEEN 1 AND 1000000
            )
        ),
    ADD CONSTRAINT ck_tenant_product_spus_art_member_snapshot
        CHECK (
            (art_member_id IS NULL) =
            (art_member_name_snapshot IS NULL)
        ),
    ADD CONSTRAINT ck_tenant_product_spus_developer_member_snapshot
        CHECK (
            (developer_member_id IS NULL) =
            (developer_member_name_snapshot IS NULL)
        ),
    ADD CONSTRAINT ck_tenant_product_spus_developer_assistant_snapshot
        CHECK (
            (developer_assistant_member_id IS NULL) =
            (developer_assistant_member_name_snapshot IS NULL)
        ),
    ADD CONSTRAINT ck_tenant_product_spus_sales_member_snapshot
        CHECK (
            (sales_member_id IS NULL) =
            (sales_member_name_snapshot IS NULL)
        );

CREATE INDEX idx_tenant_product_spus_category
    ON tenant_product_spus (tenant_id, category_id, status, business_code, id);
CREATE INDEX idx_tenant_product_spus_package_material
    ON tenant_product_spus (tenant_id, package_material_id);

ALTER TABLE tenant_product_skus
    ADD COLUMN name_en VARCHAR(200),
    ADD COLUMN unit_cost NUMERIC(14, 4),
    ADD COLUMN currency_code VARCHAR(3),
    ADD COLUMN default_warehouse_id UUID,
    ADD COLUMN default_warehouse_name_snapshot VARCHAR(200),
    ADD CONSTRAINT fk_tenant_product_skus_default_warehouse
        FOREIGN KEY (tenant_id, default_warehouse_id)
        REFERENCES tenant_warehouses (tenant_id, id),
    ADD CONSTRAINT ck_tenant_product_skus_cost_currency
        CHECK (
            (unit_cost IS NULL AND currency_code IS NULL)
            OR (
                unit_cost BETWEEN 0 AND 9999999999.9999
                AND currency_code ~ '^[A-Z]{3}$'
            )
        ),
    ADD CONSTRAINT ck_tenant_product_skus_default_warehouse_snapshot
        CHECK (
            (default_warehouse_id IS NULL)
            = (default_warehouse_name_snapshot IS NULL)
        );

CREATE INDEX idx_tenant_product_skus_default_warehouse
    ON tenant_product_skus (tenant_id, default_warehouse_id);

CREATE TABLE tenant_product_spu_images (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    spu_id UUID NOT NULL,
    object_key VARCHAR(64) NOT NULL,
    content_type VARCHAR(20) NOT NULL,
    file_extension VARCHAR(5) NOT NULL,
    byte_size BIGINT NOT NULL,
    sha256 VARCHAR(64) NOT NULL,
    pixel_width INTEGER NOT NULL,
    pixel_height INTEGER NOT NULL,
    sort_order INTEGER NOT NULL,
    primary_image BOOLEAN NOT NULL DEFAULT false,
    created_by_type VARCHAR(24) NOT NULL,
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    version BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT uq_tenant_product_spu_images_tenant_id
        UNIQUE (tenant_id, id),
    CONSTRAINT uq_tenant_product_spu_images_object_key
        UNIQUE (object_key),
    CONSTRAINT fk_tenant_product_spu_images_spu
        FOREIGN KEY (tenant_id, spu_id)
        REFERENCES tenant_product_spus (tenant_id, id),
    CONSTRAINT ck_tenant_product_spu_images_object_key
        CHECK (object_key ~ '^[0-9a-f]{32}\.(jpg|png)$'),
    CONSTRAINT ck_tenant_product_spu_images_content
        CHECK (
            (content_type = 'image/jpeg' AND file_extension = '.jpg')
            OR (content_type = 'image/png' AND file_extension = '.png')
        ),
    CONSTRAINT ck_tenant_product_spu_images_size
        CHECK (byte_size BETWEEN 1 AND 5242880),
    CONSTRAINT ck_tenant_product_spu_images_sha256
        CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    CONSTRAINT ck_tenant_product_spu_images_pixels
        CHECK (
            pixel_width BETWEEN 1 AND 10000
            AND pixel_height BETWEEN 1 AND 10000
            AND pixel_width::BIGINT * pixel_height::BIGINT <= 40000000
        ),
    CONSTRAINT ck_tenant_product_spu_images_sort_order
        CHECK (sort_order BETWEEN 0 AND 32767),
    CONSTRAINT ck_tenant_product_spu_images_created_by
        CHECK (created_by_type IN ('TENANT_USER', 'SYSTEM_ADMIN')),
    CONSTRAINT ck_tenant_product_spu_images_version
        CHECK (version >= 0),
    CONSTRAINT ck_tenant_product_spu_images_timestamps
        CHECK (updated_at >= created_at)
);

CREATE UNIQUE INDEX uq_tenant_product_spu_images_primary
    ON tenant_product_spu_images (tenant_id, spu_id)
    WHERE primary_image;
CREATE INDEX idx_tenant_product_spu_images_list
    ON tenant_product_spu_images (
        tenant_id, spu_id, primary_image DESC, sort_order, id
    );

INSERT INTO permissions (id, code, module, name, description)
VALUES
    ('71000000-0000-0000-0000-000000000005',
     'products.master_data.read', 'products',
     '读取商品主数据', '读取租户商品类目与包材主数据'),
    ('71000000-0000-0000-0000-000000000006',
     'products.master_data.write', 'products',
     '管理商品主数据', '管理租户商品类目与包材主数据')
ON CONFLICT (code) DO UPDATE SET
    module = EXCLUDED.module,
    name = EXCLUDED.name,
    description = EXCLUDED.description;

INSERT INTO role_permissions (tenant_id, role_id, permission_id)
SELECT role.tenant_id, role.id, permission.id
FROM roles role
CROSS JOIN permissions permission
WHERE role.system_role = true
  AND role.code = 'tenant_admin'
  AND permission.code IN (
      'products.master_data.read',
      'products.master_data.write'
  )
ON CONFLICT (role_id, permission_id) DO NOTHING;
