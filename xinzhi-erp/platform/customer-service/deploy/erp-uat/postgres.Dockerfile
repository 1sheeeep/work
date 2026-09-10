FROM postgres:16-alpine@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777
COPY deploy/postgres-init/001_customer_service_schema_roles.sql /docker-entrypoint-initdb.d/001_customer_service_schema_roles.sql
COPY deploy/erp-uat/002_set_uat_role_passwords.sh /docker-entrypoint-initdb.d/002_set_uat_role_passwords.sh
RUN chmod 755 /docker-entrypoint-initdb.d/002_set_uat_role_passwords.sh
