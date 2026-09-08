#!/bin/sh
set -eu

DURATION_SECONDS="${1:-3600}"
INTERVAL_SECONDS="${2:-30}"
OUTPUT_DIR="${3:-/private/tmp/recruitment-soak}"

case "$DURATION_SECONDS:$INTERVAL_SECONDS" in
  *[!0-9:]*|:*|*:) echo "duration and interval must be positive integer seconds" >&2; exit 2 ;;
esac
if [ "$DURATION_SECONDS" -lt 1 ] || [ "$INTERVAL_SECONDS" -lt 1 ]; then
  echo "duration and interval must be positive" >&2
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

printf 'timestamp\thealth\tmetrics_ok\tprometheus_up\tprocess_uptime\tqueue_depth\toldest_seconds\tsend_unknown\tai_available\tai_capacity\tdb_pending\theap_percent\n' > "$SAMPLES"

metric() {
  printf '%s\n' "$METRICS" | awk -v name="$1" '$1 == name { print $2; exit }'
}

while [ "$(date +%s)" -lt "$END_EPOCH" ]; do
  TIMESTAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  HEALTH="DOWN"
  if curl -fsS --max-time 5 http://localhost:8088/actuator/health | grep -q '"status":"UP"'; then HEALTH="UP"; fi

  METRICS="$(docker compose exec -T backend curl -fsS --max-time 5 http://localhost:8080/actuator/prometheus 2>/dev/null || true)"
  METRICS_OK="$(printf '%s\n' "$METRICS" | grep -q '^recruitment_inbound_reply_model_slots_capacity ' && echo 1 || echo 0)"
  PROM_UP="$(docker compose exec -T prometheus wget -qO- 'http://localhost:9090/api/v1/query?query=up%7Bjob%3D%22recruitment-backend%22%7D' 2>/dev/null | grep -q '"value".*"1"' && echo 1 || echo 0)"
  UPTIME="$(metric process_uptime_seconds)"; UPTIME="${UPTIME:-0}"
  QUEUE_DEPTH="$(metric recruitment_inbound_reply_queue_depth)"; QUEUE_DEPTH="${QUEUE_DEPTH:-0}"
  OLDEST="$(metric recruitment_inbound_reply_queue_oldest_seconds)"; OLDEST="${OLDEST:-0}"
  UNKNOWN="$(metric recruitment_inbound_reply_send_unknown)"; UNKNOWN="${UNKNOWN:-0}"
  AI_AVAILABLE="$(metric recruitment_inbound_reply_model_slots_available)"; AI_AVAILABLE="${AI_AVAILABLE:-0}"
  AI_CAPACITY="$(metric recruitment_inbound_reply_model_slots_capacity)"; AI_CAPACITY="${AI_CAPACITY:-0}"
  DB_PENDING="$(printf '%s\n' "$METRICS" | awk '$1 ~ /^hikaricp_connections_pending/ { sum += $NF } END { print sum + 0 }')"
  HEAP_PERCENT="$(printf '%s\n' "$METRICS" | awk '$1 ~ /^jvm_memory_used_bytes/ && $0 ~ /area="heap"/ { used += $NF } $1 ~ /^jvm_memory_max_bytes/ && $0 ~ /area="heap"/ && $NF > 0 { max += $NF } END { if (max > 0) printf "%.2f", used * 100 / max; else print 0 }')"

  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$TIMESTAMP" "$HEALTH" "$METRICS_OK" "$PROM_UP" "$UPTIME" "$QUEUE_DEPTH" "$OLDEST" "$UNKNOWN" "$AI_AVAILABLE" "$AI_CAPACITY" "$DB_PENDING" "$HEAP_PERCENT" >> "$SAMPLES"
  SAMPLE_COUNT=$((SAMPLE_COUNT + 1))
  [ "$HEALTH" = UP ] || FAILURES=$((FAILURES + 1))
  [ "$METRICS_OK" = 1 ] || FAILURES=$((FAILURES + 1))
  [ "$PROM_UP" = 1 ] || FAILURES=$((FAILURES + 1))
  awk -v value="$UNKNOWN" 'BEGIN { exit !(value > 0) }' && FAILURES=$((FAILURES + 1)) || true
  awk -v value="$OLDEST" 'BEGIN { exit !(value > 180) }' && FAILURES=$((FAILURES + 1)) || true
  awk -v value="$AI_CAPACITY" 'BEGIN { exit !(value < 1) }' && FAILURES=$((FAILURES + 1)) || true
  awk -v value="$DB_PENDING" 'BEGIN { exit !(value > 0) }' && FAILURES=$((FAILURES + 1)) || true
  awk -v value="$HEAP_PERCENT" 'BEGIN { exit !(value >= 85) }' && FAILURES=$((FAILURES + 1)) || true
  if [ -n "$PREVIOUS_UPTIME" ] && awk -v previous="$PREVIOUS_UPTIME" -v current="$UPTIME" 'BEGIN { exit !(current < previous) }'; then
    RESTARTS=$((RESTARTS + 1)); FAILURES=$((FAILURES + 1))
  fi
  PREVIOUS_UPTIME="$UPTIME"
  MAX_QUEUE_DEPTH="$(awk -v a="$MAX_QUEUE_DEPTH" -v b="$QUEUE_DEPTH" 'BEGIN { print (b > a ? b : a) }')"
  MAX_OLDEST_SECONDS="$(awk -v a="$MAX_OLDEST_SECONDS" -v b="$OLDEST" 'BEGIN { print (b > a ? b : a) }')"
  MAX_HEAP_PERCENT="$(awk -v a="$MAX_HEAP_PERCENT" -v b="$HEAP_PERCENT" 'BEGIN { print (b > a ? b : a) }')"
  MAX_DB_PENDING="$(awk -v a="$MAX_DB_PENDING" -v b="$DB_PENDING" 'BEGIN { print (b > a ? b : a) }')"
  sleep "$INTERVAL_SECONDS"
done

{
  echo "run_id=$RUN_ID"
  echo "duration_seconds=$DURATION_SECONDS"
  echo "interval_seconds=$INTERVAL_SECONDS"
  echo "samples=$SAMPLE_COUNT"
  echo "failures=$FAILURES"
  echo "max_queue_depth=$MAX_QUEUE_DEPTH"
  echo "max_oldest_seconds=$MAX_OLDEST_SECONDS"
  echo "max_heap_percent=$MAX_HEAP_PERCENT"
  echo "max_db_pending=$MAX_DB_PENDING"
  echo "backend_restarts=$RESTARTS"
  echo "samples_file=$SAMPLES"
} > "$SUMMARY"
cat "$SUMMARY"
[ "$FAILURES" -eq 0 ]
