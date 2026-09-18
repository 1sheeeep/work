#!/usr/bin/python3
"""Root-owned, forced-command receiver for recruitment-console releases."""

import fcntl
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.request
import zipfile


ROOT = Path('/opt/recruitment-console')
RELEASES = ROOT / 'releases'
BACKUPS = ROOT / 'backups'
ENV = ROOT / '.env'
COMPOSE = ROOT / 'compose.yaml'
BACKEND = 'recruitment-console-backend-1'
WEB = 'recruitment-console-web-1'
DB = 'recruitment-console-db-1'
LOCK = Path('/opt/xzdesk/runtime/deploy/operation.lock')
REPOSITORY = 'xz-development/recruitment-console'
PUBLIC_URLS = (
    'http://127.0.0.1:8088/actuator/health/readiness',
    'https://hr.xzkj.ai/actuator/health/readiness',
)
MAX_BUNDLE = 256 * 1024 * 1024
OUTER_FILES = {'app.jar', 'web.tar', 'browser-bridge.tar', 'local-connector.tar', 'manifest.txt'}


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def command(value):
    if value == 'verify':
        return ('verify',)
    match = re.fullmatch(r'deploy ([0-9a-f]{40}) ([0-9a-f]{64})', value)
    require(match is not None, 'Only verify or SHA256-bound recruitment deployments are allowed')
    return match.groups()


def run(args, timeout=180):
    result = subprocess.run(args, capture_output=True, timeout=timeout)
    require(result.returncode == 0, 'Command failed: ' + args[0])
    return result.stdout


def inspect(name):
    return json.loads(run(['docker', 'inspect', name]))[0]


def healthy(name):
    state = inspect(name).get('State', {})
    return state.get('Status') == 'running' and state.get('Health', {}).get('Status') == 'healthy'


def image_name(name):
    value = inspect(name).get('Config', {}).get('Image', '')
    require(re.fullmatch(r'[A-Za-z0-9./:@_-]+', value) is not None, 'Unexpected current image name')
    run(['docker', 'image', 'inspect', value])
    return value


def protected():
    names = run(['docker', 'ps', '--format', '{{.Names}}']).decode().splitlines()
    return {
        name: (inspect(name).get('Id'), inspect(name).get('State', {}).get('StartedAt'),
               inspect(name).get('Config', {}).get('Image'))
        for name in names if name not in (BACKEND, WEB)
    }


def check_tar(archive, exact=None):
    members = archive.getmembers()
    names = [member.name for member in members]
    require(len(names) == len(set(names)), 'Duplicate archive entries')
    require(len(names) <= 10000 and sum(member.size for member in members) <= MAX_BUNDLE,
            'Archive too large')
    for member in members:
        path = PurePosixPath(member.name)
        require(not path.is_absolute() and '..' not in path.parts and '\\' not in member.name,
                'Unsafe archive path')
        require(member.isfile() or member.isdir(), 'Links and special files are forbidden')
    if exact is not None:
        require(set(names) == set(exact) and all(member.isfile() for member in members),
                'Unexpected bundle files')
    return members


def artifact_hash(path):
    digest = hashlib.sha256()
    with path.open('rb') as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def read_manifest(path):
    values = {}
    for line in path.read_text(encoding='utf-8').splitlines():
        key, separator, value = line.partition('=')
        require(separator and re.fullmatch(r'[a-z][a-z0-9_.-]*', key) is not None and value,
                'Invalid release manifest')
        require(key not in values, 'Duplicate release manifest key')
        values[key] = value
    require(set(values) == {'repository', 'commit', 'app.jar', 'web.tar', 'browser-bridge.tar', 'local-connector.tar'},
            'Incomplete release manifest')
    return values


def check_inner_tar(path):
    with tarfile.open(path, 'r') as archive:
        check_tar(archive)


def receive(sha, digest, stream):
    RELEASES.mkdir(mode=0o700, exist_ok=True)
    directory = RELEASES / (sha[:12] + '-' + digest[:12])
    require(not directory.exists(), 'Release directory already exists')
    directory.mkdir(mode=0o700)
    bundle = directory / 'bundle.tar.gz'
    total = 0
    actual = hashlib.sha256()
    with bundle.open('wb') as output:
        while chunk := stream.read(1024 * 1024):
            total += len(chunk)
            require(total <= MAX_BUNDLE, 'Bundle too large')
            actual.update(chunk)
            output.write(chunk)
    require(actual.hexdigest() == digest, 'Bundle checksum mismatch')
    with tarfile.open(bundle, 'r:gz') as archive:
        for member in check_tar(archive, OUTER_FILES):
            with archive.extractfile(member) as source, (directory / member.name).open('wb') as output:
                shutil.copyfileobj(source, output)
    manifest = read_manifest(directory / 'manifest.txt')
    require(manifest['repository'] == REPOSITORY and manifest['commit'] == sha,
            'Wrong release identity')
    for name in OUTER_FILES - {'manifest.txt'}:
        require(artifact_hash(directory / name) == manifest[name], 'Artifact checksum mismatch')
    check_inner_tar(directory / 'web.tar')
    check_inner_tar(directory / 'browser-bridge.tar')
    check_inner_tar(directory / 'local-connector.tar')
    return directory


def migrations(path):
    with zipfile.ZipFile(path) as jar:
        names = [name for name in jar.namelist()
                 if name.startswith('BOOT-INF/classes/db/migration/') and name.endswith('.sql')]
        require(names and len(names) == len(set(names)), 'Invalid migration set')
        require(sum(jar.getinfo(name).file_size for name in names) < 20 * 1024 * 1024,
                'Oversized migrations')
        return {name: hashlib.sha256(jar.read(name)).hexdigest() for name in names}


def env_value(key):
    prefix = key + '='
    for line in ENV.read_text(encoding='utf-8').splitlines():
        if line.startswith(prefix):
            return line[len(prefix):]
    raise RuntimeError('Missing runtime setting: ' + key)


def ready():
    for url in PUBLIC_URLS:
        try:
            with urllib.request.urlopen(url, timeout=20) as response:
                require(response.status == 200, 'Readiness failed')
        except Exception as error:
            raise RuntimeError('Readiness failed') from error


def compose_up(override, service):
    run([
        'docker', 'compose', '--env-file', str(ENV), '-f', str(COMPOSE), '-f', str(override),
        'up', '-d', '--no-deps', '--no-build', '--wait', '--wait-timeout', '180', service,
    ], timeout=240)


def compose_config(override):
    run(['docker', 'compose', '--env-file', str(ENV), '-f', str(COMPOSE), '-f', str(override),
         'config', '--quiet'])


def backup(sha, digest):
    BACKUPS.mkdir(mode=0o700, exist_ok=True)
    directory = BACKUPS / (sha[:12] + '-' + digest[:12])
    require(not directory.exists(), 'Backup directory already exists')
    directory.mkdir(mode=0o700)
    shutil.copy2(ENV, directory / 'environment')
    shutil.copy2(COMPOSE, directory / 'compose.yaml')
    dump = directory / 'database.dump'
    with dump.open('wb') as output:
        result = subprocess.run(
            ['docker', 'exec', DB, 'pg_dump', '-U', env_value('POSTGRES_USER'),
             '-d', env_value('POSTGRES_DB'), '-Fc'],
            stdout=output, stderr=subprocess.PIPE, timeout=300,
        )
    require(result.returncode == 0 and dump.stat().st_size > 1000, 'Database backup failed')
    (directory / 'database.dump.sha256').write_text(artifact_hash(dump) + '  database.dump\n', encoding='ascii')
    return directory


def deploy(sha, digest):
    require(healthy(BACKEND) and healthy(WEB) and healthy(DB), 'Current recruitment runtime is unhealthy')
    require(shutil.disk_usage(ROOT).free > 2 * 1024 ** 3, 'Insufficient free disk')
    previous_backend = image_name(BACKEND)
    previous_web = image_name(WEB)
    before = protected()
    previous_handle = tempfile.NamedTemporaryFile(prefix='recruitment-current-', suffix='.jar', dir='/tmp', delete=False)
    previous_bundle = Path(previous_handle.name)
    previous_handle.close()
    directory = receive(sha, digest, sys.stdin.buffer)
    try:
        run(['docker', 'cp', BACKEND + ':/app/app.jar', str(previous_bundle)])
        previous_migrations = migrations(previous_bundle)
        candidate_migrations = migrations(directory / 'app.jar')
        require(previous_migrations == candidate_migrations,
                'Database migrations differ; reviewed migration release is required')
        backend_image = 'recruitment-console-backend:release-' + sha[:12] + '-' + digest[:12]
        web_image = 'recruitment-console-web:release-' + sha[:12] + '-' + digest[:12]
        override = directory / 'compose.override.yaml'
        override.write_text(
            'services:\n'
            '  backend:\n'
            '    image: ' + backend_image + '\n'
            '    build: null\n'
            '  web:\n'
            '    image: ' + web_image + '\n'
            '    build: null\n', encoding='ascii')
        rollback_override = directory / 'compose.rollback.yaml'
        rollback_override.write_text(
            'services:\n'
            '  backend:\n'
            '    image: ' + previous_backend + '\n'
            '    build: null\n'
            '  web:\n'
            '    image: ' + previous_web + '\n'
            '    build: null\n', encoding='ascii')
        (directory / 'backend.Dockerfile').write_text(
            'FROM ' + previous_backend + '\n'
            'COPY --chown=app:app app.jar /app/app.jar\n'
            'LABEL org.opencontainers.image.revision="' + sha + '"\n', encoding='ascii')
        (directory / 'web.Dockerfile').write_text(
            'FROM ' + previous_web + '\n'
            'COPY web/ /srv/\n'
            'LABEL org.opencontainers.image.revision="' + sha + '"\n', encoding='ascii')
        run(['docker', 'build', '--network=none', '--pull=false', '-f', str(directory / 'backend.Dockerfile'),
             '-t', backend_image, str(directory)], timeout=600)
        run(['docker', 'build', '--network=none', '--pull=false', '-f', str(directory / 'web.Dockerfile'),
             '-t', web_image, str(directory)], timeout=600)
        compose_config(override)
        receipt = {
            'repository': REPOSITORY,
            'commit': sha,
            'bundleSha256': digest,
            'previousImages': {'backend': previous_backend, 'web': previous_web},
            'images': {'backend': backend_image, 'web': web_image},
            'previousMigrationCount': len(previous_migrations),
            'candidateMigrationCount': len(candidate_migrations),
        }
        backup_directory = backup(sha, digest)
        receipt['backup'] = str(backup_directory)
        ready()
        compose_up(override, 'backend')
        compose_up(override, 'web')
        require(healthy(BACKEND) and healthy(WEB), 'New recruitment runtime is unhealthy')
        ready()
        require(COMPOSE.read_bytes() == backup_directory.joinpath('compose.yaml').read_bytes(),
                'Compose changed concurrently')
        require(protected() == before, 'Another system changed during release')
        receipt['status'] = 'deployed'
        (directory / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n', encoding='utf-8')
        print(json.dumps(receipt), flush=True)
    except Exception:
        try:
            compose_up(directory / 'compose.rollback.yaml', 'backend')
            compose_up(directory / 'compose.rollback.yaml', 'web')
            ready()
        finally:
            raise
    finally:
        previous_bundle.unlink(missing_ok=True)


def verify():
    require(healthy(BACKEND) and healthy(WEB) and healthy(DB), 'Current recruitment runtime is unhealthy')
    ready()
    print(json.dumps({
        'status': 'ready',
        'backend': inspect(BACKEND).get('Config', {}).get('Image'),
        'web': inspect(WEB).get('Config', {}).get('Image'),
    }), flush=True)


def main():
    require(os.geteuid() == 0, 'Root execution is required')
    require(run(['hostname']).decode().strip() == 'ip-172-26-11-217', 'Wrong runtime')
    action = command(sys.argv[1] if len(sys.argv) == 2 else '')
    with LOCK.open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if action[0] == 'verify':
            verify()
        else:
            deploy(*action)


if __name__ == '__main__':
    main()
