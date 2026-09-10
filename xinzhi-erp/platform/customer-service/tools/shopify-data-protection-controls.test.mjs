import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const toolsDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(toolsDir, "..");

function source(relativePath) {
  return readFileSync(path.join(root, relativePath), "utf8");
}

test("production backup fails closed unless customer data is encrypted at rest", () => {
  const compose = source("deploy/compose.production.yml");
  const backup = source("deploy/backup-production.sh");
  const atRest = source("deploy/verify-at-rest-encryption.sh");
  const prepare = source("deploy/prepare-production-data-protection.sh");

  assert.match(backup, /sh "\$at_rest_check" "\$env_file" "\$data_mount"/);
  assert.ok(
    backup.indexOf('sh "$at_rest_check"') < backup.indexOf("mktemp -d"),
    "at-rest encryption must be verified before plaintext staging is created",
  );
  assert.match(atRest, /must be provider-managed for the current production layout/);
  assert.match(atRest, /\^database_encryption=enabled\$/);
  assert.match(atRest, /\^uploads_encryption=enabled\$/);
  assert.match(atRest, /\^backups_encryption=enabled\$/);
  assert.match(atRest, /requires a dedicated data mount/);
  assert.match(atRest, /requires PostgreSQL under/);
  assert.match(atRest, /requires uploads under/);
  assert.match(atRest, /requires backups under/);
  assert.match(prepare, /install -d -o 70 -g 70 -m 700 "\$postgres_dir"/);
  assert.match(compose, /source: "\$\{XZDESK_POSTGRES_HOST_DIR:\?XZDESK_POSTGRES_HOST_DIR is required\}"/);
  assert.doesNotMatch(compose, /postgres-data:/);
});

test("production backup encrypts database, uploads, and configuration before publication", () => {
  const backup = source("deploy/backup-production.sh");

  assert.match(backup, /pg_dump[\s\S]+postgres\.dump/);
  assert.match(backup, /pg_restore --list < "\$dump_file"/);
  assert.match(backup, /contents=database,uploads,configuration/);
  assert.match(backup, /Required backup command is unavailable: GNU tar/);
  assert.match(backup, /tar -cf "\$archive_file"[\s\S]+MANIFEST\.txt database config[\s\S]+"\$upload_name"/);
  assert.match(backup, /age -R "\$recipients_file" -o "\$encrypted_tmp" "\$archive_file"/);
  assert.match(backup, /sha256sum xzdesk-backup\.tar\.age > SHA256SUMS/);
  assert.doesNotMatch(backup, /mv "\$staging" "\$destination"/);
});

test("backup retention is capped at 30 days and legacy long-term copies block the job", () => {
  const backup = source("deploy/backup-production.sh");
  const env = source("deploy/production.env.example");

  assert.match(backup, /"\$retention_days" -gt 30/);
  assert.match(backup, /legacy monthly backups must be reviewed/);
  assert.match(backup, /-mmin "\+\$retention_minutes"/);
  assert.match(env, /^XZDESK_BACKUP_RETENTION_DAYS=30$/m);
  assert.doesNotMatch(env, /XZDESK_MONTHLY_BACKUP_RETENTION_DAYS/);
});

test("restore verification authenticates, decrypts, validates paths, and checks the dump", () => {
  const verify = source("deploy/verify-encrypted-backup.sh");

  assert.match(verify, /sha256sum -c SHA256SUMS/);
  assert.match(verify, /age --decrypt -i "\$identity_file"/);
  assert.match(verify, /Encrypted backup contains an unsafe archive path/);
  assert.match(verify, /\^backup_retention_days=\(\[1-9\]\|\[12\]\[0-9\]\|30\)\$/);
  assert.match(verify, /pg_restore --list "\$extract_dir\/database\/postgres\.dump"/);
});

test("systemd invokes the non-executable tracked shell script safely", () => {
  const service = source("deploy/systemd/xzdesk-backup.service");

  assert.match(service, /^ExecStart=\/bin\/sh \/opt\/xzdesk\/deploy\/backup-production\.sh$/m);
  assert.match(service, /^ExecStartPre=\/usr\/bin\/test -x \/usr\/bin\/age$/m);
  assert.match(service, /^ExecStartPre=\/usr\/bin\/test -f \/etc\/xzdesk\/backup-recipients\.txt$/m);
});

test("application-to-PostgreSQL traffic requires verified TLS", () => {
  const compose = source("deploy/compose.production.yml");
  const prepare = source("deploy/prepare-production-data-protection.sh");

  assert.match(compose, /sslmode=verify-full&sslrootcert=\/etc\/xzdesk\/postgres-tls\/server\.crt/);
  assert.match(compose, /ssl=on/);
  assert.match(compose, /ssl_cert_file=\/etc\/xzdesk\/postgres-tls\/server\.crt/);
  assert.match(compose, /ssl_key_file=\/etc\/xzdesk\/postgres-tls\/server\.key/);
  assert.doesNotMatch(compose, /sslmode=disable/);
  assert.match(prepare, /subjectAltName=DNS:postgres/);
  assert.match(prepare, /checkend 2592000/);
  assert.match(prepare, /test "\$key_hash" = "\$cert_hash"/);
  assert.match(prepare, /uid\/gid 1000 to match the API container/);
  assert.match(prepare, /install -d -o 70 -g 70 -m 700 "\$tls_dir"/);
});

test("production releases carry and activate the fail-closed data-protection controls", () => {
  const builder = source("tools/build-production-release.ps1");
  const deploy = source("deploy/deploy-blue-green.sh");

  for (const file of [
    "backup-production.sh",
    "prepare-production-data-protection.sh",
    "verify-at-rest-encryption.sh",
    "verify-encrypted-backup.sh",
  ]) {
    assert.ok(builder.includes(`deploy\\${file}`), `${file} is missing from the release builder`);
    assert.ok(deploy.includes(`release_dir/${file}`), `${file} is missing from the installer`);
  }
  for (const unit of ["xzdesk-backup.service", "xzdesk-backup.timer"]) {
    assert.ok(builder.includes(`deploy\\systemd\\${unit}`), `${unit} is missing from the release builder`);
    assert.ok(deploy.includes(`release_dir/systemd/${unit}`), `${unit} is missing from the installer`);
  }
  assert.ok(
    deploy.indexOf('install -o root -g ubuntu -m 640 "$release_dir/backup-production.sh"') <
      deploy.indexOf('runuser -u ubuntu -- /bin/sh "$deploy_dir/backup-production.sh"'),
    "the encrypted backup control must replace the legacy script before the pre-deploy backup",
  );
  assert.match(
    deploy,
    /install -o root -g ubuntu -m 640 "\$release_dir\/verify-at-rest-encryption\.sh"/,
  );
  assert.ok(
    deploy.indexOf('runuser -u ubuntu -- /bin/sh "$deploy_dir/backup-production.sh"') <
      deploy.indexOf('systemctl enable --now xzdesk-backup.timer'),
    "the timer must be activated only after an encrypted backup succeeds",
  );
  assert.ok(
    deploy.indexOf('systemctl enable --now xzdesk-backup.timer') <
      deploy.indexOf('cp "$release_dir/compose.production.yml"'),
    "the verified backup schedule must be installed before changing the running compose definition",
  );
});
