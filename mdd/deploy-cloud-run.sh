#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 || $# -gt 3 ]]; then
  echo "Usage: $0 PROJECT_ID REGION [SERVICE_NAME]" >&2
  exit 2
fi
if [[ -z "${MDD_API_KEY:-}" ]]; then
  echo "MDD_API_KEY must be set to a strong shared secret." >&2
  echo "Generate one with: export MDD_API_KEY=\$(openssl rand -hex 32)" >&2
  exit 2
fi

PROJECT_ID=$1
REGION=$2
SERVICE_NAME=${3:-little-chapters-mdd}
IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/little-chapters/${SERVICE_NAME}:$(git rev-parse --short HEAD)"
# Default stays 0 (scale-to-zero, no idle cost) — unchanged behavior unless
# you opt in. Setting this to 1 keeps one instance warm at all times, which
# eliminates the model-reload cold start on every scale-from-zero at the
# cost of paying for that instance continuously. See docs/DECODING_GRADER.md
# "Deploying on Cloud Run" for the cold-start timing this trades off against.
MIN_INSTANCES=${MDD_MIN_INSTANCES:-0}

gcloud artifacts repositories describe little-chapters \
  --project "$PROJECT_ID" --location "$REGION" >/dev/null

gcloud builds submit mdd --project "$PROJECT_ID" --tag "$IMAGE"
gcloud run deploy "$SERVICE_NAME" \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --image "$IMAGE" \
  --execution-environment gen2 \
  --allow-unauthenticated \
  --cpu 2 \
  --memory 4Gi \
  --concurrency 1 \
  --min "$MIN_INSTANCES" \
  --max 1 \
  --timeout 300 \
  --startup-probe 'httpGet.path=/healthz,initialDelaySeconds=0,timeoutSeconds=5,periodSeconds=10,failureThreshold=30' \
  --set-env-vars "MDD_API_KEY=${MDD_API_KEY}"

SERVICE_URL=$(gcloud run services describe "$SERVICE_NAME" \
  --project "$PROJECT_ID" --region "$REGION" --format='value(status.url)')
printf '\nMDD_SERVER_URL=%s\n' "$SERVICE_URL"
printf 'MDD_API_KEY=%s\n' "$MDD_API_KEY"
printf '\nHealth check (cold start can take time):\ncurl --fail --retry 12 --retry-all-errors --retry-delay 10 %s/healthz\n' "$SERVICE_URL"
