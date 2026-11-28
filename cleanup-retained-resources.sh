#!/usr/bin/env bash
set -euo pipefail

REGION="us-east-1"
EXPECTED_ACCOUNT="345549356290"

BUCKETS=(
  "observabilityarchivestack-observabilitylogarchive4-ffbxdvesrk83"
  "observabilityarchivestack-observabilitylogarchive4-gpgw8hji804g"
)

SNAPSHOT="observability-mysql-before-logging"

echo "========== VERIFY AWS ACCOUNT =========="

ACCOUNT=$(aws sts get-caller-identity --query Account --output text)

if [[ "$ACCOUNT" != "$EXPECTED_ACCOUNT" ]]; then
    echo "ERROR: Unexpected AWS account: $ACCOUNT"
    exit 1
fi

echo "Confirmed account: $ACCOUNT"
echo
echo "========== RESOURCES TO BE PERMANENTLY DELETED =========="

printf 'S3 bucket: %s\n' "${BUCKETS[@]}"
echo "RDS snapshot: $SNAPSHOT"
echo
echo "This permanently deletes the archive data and database recovery copy."
read -r -p "Type DELETE_ALL_OBSERVABILITY_RESOURCES to continue: " CONFIRM

if [[ "$CONFIRM" != "DELETE_ALL_OBSERVABILITY_RESOURCES" ]]; then
    echo "Cancelled. No resources deleted."
    exit 0
fi

TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

for BUCKET in "${BUCKETS[@]}"; do
    echo
    echo "========== PROCESSING BUCKET: $BUCKET =========="

    if ! aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
        echo "Bucket is already absent or inaccessible: $BUCKET"
        continue
    fi

    aws s3api list-object-versions \
        --bucket "$BUCKET" \
        --region "$REGION" \
        --output json > "$TMP_DIR/versions.json"

    python3 - "$TMP_DIR/versions.json" "$TMP_DIR/delete.json" <<'PY'
import json, sys

with open(sys.argv[1]) as f:
    data = json.load(f)

objects = []

for item in data.get("Versions", []):
    objects.append({
        "Key": item["Key"],
        "VersionId": item["VersionId"]
    })

for item in data.get("DeleteMarkers", []):
    objects.append({
        "Key": item["Key"],
        "VersionId": item["VersionId"]
    })

with open(sys.argv[2], "w") as f:
    json.dump({"Objects": objects, "Quiet": True}, f)

print("Object versions and delete markers found:", len(objects))
PY

    COUNT=$(python3 -c \
      'import json,sys; print(len(json.load(open(sys.argv[1]))["Objects"]))' \
      "$TMP_DIR/delete.json")

    if (( COUNT > 0 )); then
        echo "Deleting $COUNT object versions/delete markers..."

        aws s3api delete-objects \
            --bucket "$BUCKET" \
            --region "$REGION" \
            --delete "file://$TMP_DIR/delete.json" \
            --output json > "$TMP_DIR/delete-result.json"

        python3 - "$TMP_DIR/delete-result.json" <<'PY'
import json, sys

with open(sys.argv[1]) as f:
    result = json.load(f)

errors = result.get("Errors", [])

if errors:
    print("S3 deletion errors:")
    for error in errors:
        print(error)
    sys.exit(1)

print("Successfully deleted:", len(result.get("Deleted", [])))
PY
    else
        echo "Bucket contains no object versions or delete markers."
    fi

    echo "Deleting empty bucket..."
    aws s3api delete-bucket \
        --bucket "$BUCKET" \
        --region "$REGION"

    echo "SUCCESS: Deleted $BUCKET"
done

echo
echo "========== DELETE MANUAL RDS SNAPSHOT =========="

if aws rds describe-db-snapshots \
    --db-snapshot-identifier "$SNAPSHOT" \
    --region "$REGION" \
    >/dev/null 2>&1; then

    aws rds delete-db-snapshot \
        --db-snapshot-identifier "$SNAPSHOT" \
        --region "$REGION"

    echo "Snapshot deletion requested: $SNAPSHOT"
else
    echo "Snapshot already absent: $SNAPSHOT"
fi

echo
echo "========== RETAINED RESOURCE CLEANUP FINISHED =========="
