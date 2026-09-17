#!/bin/sh
set -eu

DURATION_SECONDS="${1:-3600}"
INTERVAL_SECONDS="${2:-30}"
OUTPUT_DIR="${3:-/private/tmp/recruitment-soak}"
REQUIRE_ACTIVE_DUTY="${SOAK_REQUIRE_ACTIVE_DUTY:-1}"

case "$DURATION_SECONDS:$INTERVAL_SECONDS" in
  *[!0-9:]*|:*|*:) echo "duration and interval must be positive integer seconds" >&2; exit 2 ;;
esac
if [ "$DURATION_SECONDS" -lt 1 ] || [ "$INTERVAL_SECONDS" -lt 1 ]; then
  echo "duration and interval must be positive" >&2
  exit 2
fi
if [ "$REQUIRE_ACTIVE_DUTY" != 0 ] && [ "$REQUIRE_ACTIVE_DUTY" != 1 ]; then
  echo "SOAK_REQUIRE_ACTIVE_DUTY must be 0 or 1" >&2
  exit 2
fi

mkdir -p "$OUTPUT_DIR"
RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)"
SAMPLES="$OUTPUT_DIR/$RUN_ID.samples.tsv"
SUMMARY="$OUTPUT_DIR/$RUN_ID.summary.txt"
START_EPOCH="$(date +%s)"
END_EPOCH="$((START_EPOCH + DURATION_SECONDS))"
FAILURES=0
SAMPLE_COUNT=0
MAX_QUEUE_DEPTH=0
MAX_HEAP_PERCENT=0
MAX_DB_PENDING=0
MAX_OLDEST_SECONDS=0
RESTARTS=0
PREVIOUS_UPTIME=""
BASELINE_UNKNOWN=""
LOWEST_UNKNOWN=""
MAX_NEW_UNKNOWN=0

printf 'timestamp\thealth\tmetrics_ok\tprometheus_up\tactive_duty\tauto_send_enabled\tactive_devices\tstale_devices\tprocess_uptime\tqueue_depth\toldest_seconds\tsend_unknown\tnew_unknown\tai_available\tai_capacity\tdb_pending\theap_percent\n' > "$SAMPLES"

metric() {
  printf '%s\n' "$METRICS" | awk -v name="$1" '$1 == name { print $2; exit }'
}

while [ "$(date +%s)" -lt "$END_EPOCH" ]; do
  TIMESTAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  HEALTH="DOWN"
  if curl -fsS --max-time 5 http://localhost:8088/actuator/health | grep -q '"status":"UP"'; then HEALTH="UP"; fi

  METRICS="$(docker compose exec -T backend curl -fsS --max-time 5 http://localhost:8080/actuator/prometheus 2>/dev/null || true)"
  METRICS_OK=1
  for NAME in process_uptime_seconds recruitment_inbound_reply_queue_depth recruitment_inbound_reply_queue_oldest_seconds recruitment_inbound_reply_send_unknown recruitment_inbound_reply_model_slots_available recruitment_inbound_reply_model_slots_capacity recruitment_inbound_reply_auto_send_enabled recruitment_browser_devices_active recruitment_browser_devices_stale; do
    [ -n "$(metric "$NAME")" ] || METRICS_OK=0
  done
  PROM_UP="$(docker compose exec -T prometheus wget -qO- 'http://localhost:9090/api/v1/query?query=up%7Bjob%3D%22recruitment-backend%22%7D' 2>/dev/null | grep -q '"value".*"1"' && echo 1 || echo 0)"
  UPTIME="$(metric process_uptime_seconds)"; UPTIME="${UPTIME:-0}"
  QUEUE_DEPTH="$(metric recruitment_inbound_reply_queue_depth)"; QUEUE_DEPTH="${QUEUE_DEPTH:-0}"
  OLDEST="$(metric recruitment_inbound_reply_queue_oldest_seconds)"; OLDEST="${OLDEST:-0}"
  UNKNOWN="$(metric recruitment_inbound_reply_send_unknown)"; UNKNOWN="${UNKNOWN:-0}"
  AUTO_SEND="$(metric recruitment_inbound_reply_auto_send_enabled)"; AUTO_SEND="${AUTO_SEND:-0}"
  ACTIVE_DEVICES="$(metric recruitment_browser_devices_active)"; ACTIVE_DEVICES="${ACTIVE_DEVICES:-0}"
  STALE_DEVICES="$(metric recruitment_browser_devices_stale)"; STALE_DEVICES="${STALE_DEVICES:-0}"
  ACTIVE_DUTY="$(docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atqc "SELECT count(*) FROM auto_reply_policies WHERE enabled = TRUE AND auto_send_enabled = TRUE AND away_mode <> '\''IN_OFFICE'\'' AND (away_ends_at IS NULL OR away_ends_at > CURRENT_TIMESTAMP)"' 2>/dev/null || true)"
  ACTIVE_DUTY="${ACTIVE_DUTY:-0}"
  NEW_UNKNOWN=0
  if [ "$METRICS_OK" -eq 1 ]; then
    if [ -z "$BASELINE_UNKNOWN" ]; then BASELINE_UNKNOWN="$UNKNOWN"; fi
    if [ -z "$LOWEST_UNKNOWN" ] || awk -v current="$UNKNOWN" -v lowest="$LOWEST_UNKNOWN" 'BEGIN { exit !(current < lowest) }'; then
      LOWEST_UNKNOWN="$UNKNOWN"
    fi
    NEW_UNKNOWN="$(awk -v current="$UNKNOWN" -v lowest="$LOWEST_UNKNOWN" 'BEGIN { printf "%.0f", current - lowest }')"
  fi
  AI_AVAILABLE="$(metric recruitment_inbound_reply_model_slots_available)"; AI_AVAILABLE="${AI_AVAILABLE:-0}"
  AI_CAPACITY="$(metric recruitment_inbound_reply_model_slots_capacity)"; AI_CAPACITY="${AI_CAPACITY:-0}"
  DB_PENDING="$(printf '%s\n' "$METRICS" | awk '$1 ~ /^hikaricp_connections_pending/ { sum += $NF } END { print sum + 0 }')"
  HEAP_PERCENT="$(printf '%s\n' "$METRICS" | awk '$1 ~ /^jvm_memory_used_bytes/ && $0 ~ /area="heap"/ { used += $NF } $1 ~ /^jvm_memory_max_bytes/ && $0 ~ /area="heap"/ && $NF > 0 { max += $NF } END { if (max > 0) printf "%.2f", used * 100 / max; else print 0 }')"

  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$TIMESTAMP" "$HEALTH" "$METRICS_OK" "$PROM_UP" "$ACTIVE_DUTY" "$AUTO_SEND" "$ACTIVE_DEVICES" "$STALE_DEVICES" "$UPTIME" "$QUEUE_DEPTH" "$OLDEST" "$UNKNOWN" "$NEW_UNKNOWN" "$AI_AVAILABLE" "$AI_CAPACITY" "$DB_PENDING" "$HEAP_PERCENT" >> "$SAMPLES"
  SAMPLE_COUNT=$((SAMPLE_COUNT + 1))
  [ "$HEALTH" = UP ] || FAILURES=$((FAILURES + 1))
  [ "$METRICS_OK" = 1 ] || FAILURES=$((FAILURES + 1))
  [ "$PROM_UP" = 1 ] || FAILURES=$((FAILURES + 1))
  if [ "$REQUIRE_ACTIVE_DUTY" -eq 1 ]; then
    awk -v duty="$ACTIVE_DUTY" -v send="$AUTO_SEND" -v active="$ACTIVE_DEVICES" -v stale="$STALE_DEVICES" 'BEGIN { exit !(duty < 1 || send < 1 || active - stale < 1) }' && FAILURES=$((FAILURES + 1)) || true
  fi
  awk -v value="$NEW_UNKNOWN" 'BEGIN { exit !(value > 0) }' && FAILURES=$((FAILURES + 1)) || true
  awk -v value="$OLDEST" 'BEGIN { exit !(value > 180) }' && FAILURES=$((FAILURES + 1)) || true
  awk -v value="$AI_CAPACITY" 'BEGIN { exit !(value < 1) }' && FAILURES=$((FAILURES + 1)) || true
  awk -v value="$DB_PENDING" 'BEGIN { exit !(value > 0) }' && FAILURES=$((FAILURES + 1)) || true
  awk -v value="$HEAP_PERCENT" 'BEGIN { exit !(value >= 85) }' && FAILURES=$((FAILURES + 1)) || true
  if [ -n "$PREVIOUS_UPTIME" ] && awk -v previous="$PREVIOUS_UPTIME" -v current="$UPTIME" 'BEGIN { exit !(current < previous) }'; then
    RESTARTS=$((RESTARTS + 1)); FAILURES=$((FAILURES + 1))
  fi
  PREVIOUS_UPTIME="$UPTIME"
  MAX_QUEUE_DEPTH="$(awk -v a="$MAX_QUEUE_DEPTH" -v b="$QUEUE_DEPTH" 'BEGIN { print (b > a ? b : a) }')"
  MAX_NEW_UNKNOWN="$(awk -v a="$MAX_NEW_UNKNOWN" -v b="$NEW_UNKNOWN" 'BEGIN { print (b > a ? b : a) }')"
  MAX_OLDEST_SECONDS="$(awk -v a="$MAX_OLDEST_SECONDS" -v b="$OLDEST" 'BEGIN { print (b > a ? b : a) }')"
  MAX_HEAP_PERCENT="$(awk -v a="$MAX_HEAP_PERCENT" -v b="$HEAP_PERCENT" 'BEGIN { print (b > a ? b : a) }')"
  MAX_DB_PENDING="$(awk -v a="$MAX_DB_PENDING" -v b="$DB_PENDING" 'BEGIN { print (b > a ? b : a) }')"
  sleep "$INTERVAL_SECONDS"
done

{
  echo "run_id=$RUN_ID"
  echo "duration_seconds=$DURATION_SECONDS"
  echo "require_active_duty=$REQUIRE_ACTIVE_DUTY"
  echo "interval_seconds=$INTERVAL_SECONDS"
  echo "samples=$SAMPLE_COUNT"
  echo "failures=$FAILURES"
  echo "max_queue_depth=$MAX_QUEUE_DEPTH"
  echo "baseline_send_unknown=${BASELINE_UNKNOWN:-unavailable}"
  echo "max_new_send_unknown=$MAX_NEW_UNKNOWN"
  echo "max_oldest_seconds=$MAX_OLDEST_SECONDS"
  echo "max_heap_percent=$MAX_HEAP_PERCENT"
  echo "max_db_pending=$MAX_DB_PENDING"
  echo "backend_restarts=$RESTARTS"
  echo "samples_file=$SAMPLES"
} > "$SUMMARY"
cat "$SUMMARY"
[ "$FAILURES" -eq 0 ]
