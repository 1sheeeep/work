#!/bin/sh
set -eu

umask 077

action=${1:-}
release_dir=${2:-}
root_dir=${XZDESK_ROOT_DIR:-/opt/xzdesk}
deploy_dir="$root_dir/deploy"
compose_file="$deploy_dir/compose.production.yml"
env_file="$deploy_dir/production.env"
state_dir="$root_dir/runtime/deploy"
images_env="$state_dir/images.env"
releases_dir="$root_dir/runtime/releases"
caddy_file="$deploy_dir/caddy/Caddyfile"
caddy_template="$deploy_dir/caddy/Caddyfile.template"
frontend_dir="$root_dir/frontend/dist"

usage() {
  echo "Usage: deploy-blue-green.sh install RELEASE_DIR | rollback" >&2
  exit 2
}

read_file() {
  file=$1
  fallback=$2
  if [ -s "$file" ]; then
    tr -d '\r\n' < "$file"
  else
    printf '%s' "$fallback"
  fi
}

read_env() {
  file=$1
  key=$2
  fallback=$3
  value=$(awk -v key="$key" '
    index($0, key "=") == 1 {
      sub(/^[^=]*=/, "")
      value = $0
    }
    END { sub(/\r$/, "", value); print value }
  ' "$file")
  if [ -n "$value" ]; then
    printf '%s' "$value"
  else
    printf '%s' "$fallback"
  fi
}

set_env() {
  key=$1
  value=$2
  target=$3
  temp="$target.tmp"
  awk -v key="$key" -v value="$value" '
    BEGIN { found = 0 }
    index($0, key "=") == 1 {
      print key "=" value
      found = 1
      next
    }
    { print }
    END {
      if (!found) print key "=" value
    }
  ' "$target" > "$temp"
  mv "$temp" "$target"
}

write_state() {
  value=$1
  target=$2
  temp="$target.tmp"
  printf '%s\n' "$value" > "$temp"
  mv "$temp" "$target"
}

dc() {
  docker compose --env-file "$env_file" --env-file "$images_env" -f "$compose_file" "$@"
}

service_for_color() {
  case "$1" in
    blue) printf '%s' "api-blue" ;;
    green) printf '%s' "api-green" ;;
    legacy) printf '%s' "api" ;;
    *) return 1 ;;
  esac
}

upstream_for_color() {
  service=$(service_for_color "$1")
  printf '%s:8787' "$service"
}

image_for_color() {
  case "$1" in
    blue) read_env "$images_env" XZDESK_API_BLUE_IMAGE "shopify-support-platform-api:blue" ;;
    green) read_env "$images_env" XZDESK_API_GREEN_IMAGE "shopify-support-platform-api:green" ;;
    legacy) read_env "$images_env" XZDESK_API_LEGACY_IMAGE "shopify-support-platform-api:latest" ;;
    *) return 1 ;;
  esac
}

wait_healthy() {
  color=$1
  service=$(service_for_color "$color")
  attempts=0
  while [ "$attempts" -lt 30 ]; do
    container_id=$(dc --profile "$color" ps -q "$service")
    if [ -n "$container_id" ]; then
      health=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id")
      if [ "$health" = "healthy" ]; then
        return 0
      fi
      if [ "$health" = "unhealthy" ] || [ "$health" = "exited" ] || [ "$health" = "dead" ]; then
        docker logs --tail 80 "$container_id" >&2 || true
        return 1
      fi
    fi
    attempts=$((attempts + 1))
    sleep 2
  done
  if [ -n "${container_id:-}" ]; then
    docker logs --tail 80 "$container_id" >&2 || true
  fi
  return 1
}

render_caddy() {
  color=$1
  upstream=$(upstream_for_color "$color")
  temp="$state_dir/Caddyfile.$color.tmp"
  previous="$state_dir/Caddyfile.previous.tmp"
  sed "s|__XZDESK_API_UPSTREAM__|$upstream|g" "$caddy_template" > "$temp"
  if [ -f "$caddy_file" ]; then
    cp "$caddy_file" "$previous"
    cat "$temp" > "$caddy_file"
    rm -f "$temp"
  else
    mv "$temp" "$caddy_file"
  fi
  web_container=$(dc ps -q web)
  if [ -n "$web_container" ] && [ "$(docker inspect --format '{{.State.Running}}' "$web_container")" = "true" ]; then
    if ! dc exec -T web caddy validate --config - --adapter caddyfile < "$caddy_file" ||
      ! dc exec -T web caddy reload --config - --adapter caddyfile < "$caddy_file"; then
      if [ -f "$previous" ]; then
        cat "$previous" > "$caddy_file"
        dc exec -T web caddy reload --config - --adapter caddyfile < "$previous" || true
      fi
      rm -f "$previous"
      return 1
    fi
  else
    if ! dc up -d web; then
      if [ -f "$previous" ]; then
        cat "$previous" > "$caddy_file"
      fi
      rm -f "$previous"
      return 1
    fi
  fi
  rm -f "$previous"
}

deploy_frontend() {
  release_id=$1
  source_dir="$releases_dir/$release_id/frontend"
  test -d "$source_dir"
  mkdir -p "$frontend_dir"
  cp -R "$source_dir"/. "$frontend_dir"/
}

public_health() {
  expected_release=$1
  base_url=$(read_env "$env_file" PUBLIC_BASE_URL "")
  if [ -z "$base_url" ]; then
    domain=$(read_env "$env_file" XZDESK_DOMAIN "")
    base_url="https://$domain"
  fi
  response=$(curl --fail --silent --show-error --max-time 15 "$base_url/healthz")
  printf '%s' "$response" | grep -Eq '"ok"[[:space:]]*:[[:space:]]*true'
  if [ -n "$expected_release" ]; then
    printf '%s' "$response" | grep -Fq "\"release\":\"$expected_release\"" ||
      printf '%s' "$response" | grep -Eq "\"release\"[[:space:]]*:[[:space:]]*\"$expected_release\""
  fi
}

stop_color() {
  color=$1
  service=$(service_for_color "$color")
  dc --profile "$color" stop -t 20 "$service" >/dev/null
}

cleanup_old_artifacts() {
  active_color=$(read_file "$state_dir/active-color" "")
  previous_color=$(read_file "$state_dir/previous-color" "")
  active_release=$(read_file "$state_dir/active-release" "")
  previous_release=$(read_file "$state_dir/previous-release" "")
  active_image=$(image_for_color "$active_color")
  previous_image=$(image_for_color "$previous_color")

  for old_color in legacy blue green; do
    if [ "$old_color" != "$active_color" ] && [ "$old_color" != "$previous_color" ]; then
      old_service=$(service_for_color "$old_color")
      dc --profile "$old_color" rm -f -s "$old_service" >/dev/null 2>&1 || true
    fi
  done
  docker image ls --format '{{.Repository}}:{{.Tag}}' |
    awk 'index($0, "shopify-support-platform-api:") == 1' |
    while IFS= read -r old_image; do
      if [ "$old_image" != "$active_image" ] && [ "$old_image" != "$previous_image" ]; then
        docker image rm "$old_image" >/dev/null 2>&1 || true
      fi
    done
  docker image prune -f >/dev/null 2>&1 || true

  for old_release_dir in "$releases_dir"/*; do
    [ -d "$old_release_dir" ] || continue
    old_release=$(basename "$old_release_dir")
    if [ "$old_release" != "$active_release" ] && [ "$old_release" != "$previous_release" ]; then
      rm -rf -- "$old_release_dir"
    fi
  done
}

mkdir -p "$state_dir" "$releases_dir"
touch "$images_env"
chmod 700 "$state_dir" "$releases_dir"
chmod 600 "$images_env"
test -f "$env_file"
exec 9>"$state_dir/operation.lock"
if ! flock -n 9; then
  echo "Another deployment or rollback is already running" >&2
  exit 1
fi

case "$action" in
  install)
    [ -n "$release_dir" ] || usage
    test -f "$release_dir/release.env"
    test -f "$release_dir/image.tar"
    test -d "$release_dir/frontend"
    test -f "$release_dir/compose.production.yml"
    test -f "$release_dir/Caddyfile.template"
    test -f "$release_dir/backup-production.sh"
    test -f "$release_dir/prepare-production-data-protection.sh"
    test -f "$release_dir/verify-at-rest-encryption.sh"
    test -f "$release_dir/verify-encrypted-backup.sh"
    test -f "$release_dir/systemd/xzdesk-backup.service"
    test -f "$release_dir/systemd/xzdesk-backup.timer"
    test -f "$release_dir/SHA256SUMS"
    (cd "$release_dir" && sha256sum -c SHA256SUMS >/dev/null)
    release_id=$(read_env "$release_dir/release.env" XZDESK_RELEASE_ID "")
    image=$(read_env "$release_dir/release.env" XZDESK_IMAGE "")
    [ -n "$release_id" ] && [ -n "$image" ] || {
      echo "Release metadata is incomplete" >&2
      exit 1
    }
    case "$release_id" in
      *[!A-Za-z0-9_.-]*) echo "Invalid release id" >&2; exit 1 ;;
    esac
    case "$image" in
      *[!A-Za-z0-9_.:/-]*) echo "Invalid image name" >&2; exit 1 ;;
    esac

    active_color=$(read_file "$state_dir/active-color" legacy)
    case "$active_color" in
      blue) candidate_color=green ;;
      green) candidate_color=blue ;;
      legacy) candidate_color=blue ;;
      *) echo "Invalid active color: $active_color" >&2; exit 1 ;;
    esac
    active_release=$(read_file "$state_dir/active-release" legacy)
    if [ ! -d "$releases_dir/$active_release/frontend" ] && [ -d "$frontend_dir" ]; then
      mkdir -p "$releases_dir/$active_release/frontend"
      cp -R "$frontend_dir"/. "$releases_dir/$active_release/frontend"/
    fi

    install -o root -g root -m 700 "$release_dir/prepare-production-data-protection.sh" "$deploy_dir/prepare-production-data-protection.sh"
    install -o root -g ubuntu -m 640 "$release_dir/verify-at-rest-encryption.sh" "$deploy_dir/verify-at-rest-encryption.sh"
    install -o root -g root -m 700 "$release_dir/verify-encrypted-backup.sh" "$deploy_dir/verify-encrypted-backup.sh"
    install -o root -g ubuntu -m 640 "$release_dir/backup-production.sh" "$deploy_dir/backup-production.sh"
    runuser -u ubuntu -- /bin/sh "$deploy_dir/backup-production.sh"
    install -o root -g root -m 644 "$release_dir/systemd/xzdesk-backup.service" /etc/systemd/system/xzdesk-backup.service
    install -o root -g root -m 644 "$release_dir/systemd/xzdesk-backup.timer" /etc/systemd/system/xzdesk-backup.timer
    systemctl daemon-reload
    systemctl enable --now xzdesk-backup.timer >/dev/null

    cp "$release_dir/compose.production.yml" "$compose_file"
    cp "$release_dir/Caddyfile.template" "$caddy_template"
    cp "$release_dir/deploy-blue-green.sh" "$deploy_dir/deploy-blue-green.sh"
    chmod 700 "$deploy_dir/deploy-blue-green.sh"
    mkdir -p "$releases_dir/$release_id/frontend"
    cp -R "$release_dir/frontend"/. "$releases_dir/$release_id/frontend"/

    docker load -i "$release_dir/image.tar" >/dev/null
    set_env XZDESK_DEPLOY_STATE_HOST_DIR "$state_dir" "$images_env"
    set_env "XZDESK_API_$(printf '%s' "$candidate_color" | tr '[:lower:]' '[:upper:]')_IMAGE" "$image" "$images_env"
    set_env "XZDESK_API_$(printf '%s' "$candidate_color" | tr '[:lower:]' '[:upper:]')_RELEASE" "$release_id" "$images_env"

    dc up -d postgres
    candidate_service=$(service_for_color "$candidate_color")
    dc --profile "$candidate_color" up -d --no-deps "$candidate_service"
    if ! wait_healthy "$candidate_color"; then
      stop_color "$candidate_color" || true
      echo "Candidate failed health checks; active release was not changed" >&2
      exit 1
    fi

    if ! deploy_frontend "$release_id" || ! render_caddy "$candidate_color"; then
      deploy_frontend "$active_release" || true
      render_caddy "$active_color" || true
      stop_color "$candidate_color" || true
      echo "Traffic switch failed; the previous release was restored" >&2
      exit 1
    fi
    if ! public_health "$release_id"; then
      deploy_frontend "$active_release" || true
      render_caddy "$active_color" || true
      stop_color "$candidate_color" || true
      echo "Public verification failed; traffic was restored to $active_color" >&2
      exit 1
    fi

    if ! stop_color "$active_color"; then
      deploy_frontend "$active_release" || true
      render_caddy "$active_color" || true
      stop_color "$candidate_color" || true
      echo "Previous API could not be stopped; traffic was restored" >&2
      exit 1
    fi
    write_state "$active_color" "$state_dir/previous-color"
    write_state "$active_release" "$state_dir/previous-release"
    write_state "$candidate_color" "$state_dir/active-color"
    write_state "$release_id" "$state_dir/active-release"
    sleep 3
    if ! public_health "$release_id"; then
      write_state "$active_color" "$state_dir/active-color"
      write_state "$active_release" "$state_dir/active-release"
      sleep 3
      active_service=$(service_for_color "$active_color")
      if ! dc --profile "$active_color" up -d --no-deps "$active_service" ||
        ! wait_healthy "$active_color"; then
        write_state "$candidate_color" "$state_dir/active-color"
        write_state "$release_id" "$state_dir/active-release"
        echo "Final verification failed and the previous API could not be restarted; candidate remains active" >&2
        exit 1
      fi
      deploy_frontend "$active_release"
      render_caddy "$active_color"
      stop_color "$candidate_color" || true
      echo "Final verification failed; the previous release was restored" >&2
      exit 1
    fi
    cleanup_old_artifacts
    echo "Deployment complete: $release_id ($candidate_color)"
    ;;

  rollback)
    active_color=$(read_file "$state_dir/active-color" "")
    active_release=$(read_file "$state_dir/active-release" "")
    previous_color=$(read_file "$state_dir/previous-color" "")
    previous_release=$(read_file "$state_dir/previous-release" "")
    [ -n "$active_color" ] && [ -n "$previous_color" ] && [ -n "$previous_release" ] || {
      echo "No rollback release is recorded" >&2
      exit 1
    }
    write_state "$previous_color" "$state_dir/active-color"
    write_state "$previous_release" "$state_dir/active-release"
    sleep 3
    previous_service=$(service_for_color "$previous_color")
    if ! dc --profile "$previous_color" up -d --no-deps "$previous_service" ||
      ! wait_healthy "$previous_color"; then
      stop_color "$previous_color" || true
      write_state "$active_color" "$state_dir/active-color"
      write_state "$active_release" "$state_dir/active-release"
      echo "Rollback candidate failed health checks; the active release was retained" >&2
      exit 1
    fi
    if ! deploy_frontend "$previous_release" || ! render_caddy "$previous_color"; then
      deploy_frontend "$active_release" || true
      render_caddy "$active_color" || true
      stop_color "$previous_color" || true
      write_state "$active_color" "$state_dir/active-color"
      write_state "$active_release" "$state_dir/active-release"
      echo "Rollback traffic switch failed; the active release was restored" >&2
      exit 1
    fi
    expected_release=$previous_release
    if [ "$previous_color" = legacy ]; then
      expected_release=""
    fi
    if ! public_health "$expected_release"; then
      deploy_frontend "$active_release" || true
      render_caddy "$active_color" || true
      stop_color "$previous_color" || true
      write_state "$active_color" "$state_dir/active-color"
      write_state "$active_release" "$state_dir/active-release"
      echo "Rollback public verification failed; the active release was restored" >&2
      exit 1
    fi
    if ! stop_color "$active_color"; then
      deploy_frontend "$active_release" || true
      render_caddy "$active_color" || true
      stop_color "$previous_color" || true
      write_state "$active_color" "$state_dir/active-color"
      write_state "$active_release" "$state_dir/active-release"
      echo "Active API could not be stopped; rollback was cancelled" >&2
      exit 1
    fi
    write_state "$active_color" "$state_dir/previous-color"
    write_state "$active_release" "$state_dir/previous-release"
    sleep 3
    if ! public_health "$expected_release"; then
      write_state "$active_color" "$state_dir/active-color"
      write_state "$active_release" "$state_dir/active-release"
      sleep 3
      active_service=$(service_for_color "$active_color")
      if dc --profile "$active_color" up -d --no-deps "$active_service" &&
        wait_healthy "$active_color"; then
        deploy_frontend "$active_release" || true
        render_caddy "$active_color" || true
        stop_color "$previous_color" || true
      fi
      echo "Rollback final verification failed; restoration of the original release was attempted" >&2
      exit 1
    fi
    cleanup_old_artifacts
    echo "Rollback complete: $previous_release ($previous_color)"
    ;;

  *)
    usage
    ;;
esac
