#!/usr/bin/env python3
"""Stream a certified PartQuill GM catalog through the secured import API."""

from __future__ import annotations

import base64
import gzip
import hashlib
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request


BASE_URL = os.environ.get("PARTQUILL_BASE_URL", "").rstrip("/")
CATALOG_FILE = os.environ.get("GM_CATALOG_FILE", "gm-catalog.ndjson.gz")
DATASET_ID = os.environ.get("GM_DATASET_ID", "gm-exact-100001-235000-aa4d30ab-v1")
STATIC_TOKEN = os.environ.get("GM_IMPORT_TOKEN", "")
EXPECTED_COUNT = int(os.environ.get("GM_EXPECTED_COUNT", "894592"))
EXPECTED_SHA256 = os.environ.get(
    "GM_EXPECTED_SHA256",
    "aa4d30ab4a478c3187fc8d3ccfd7aa7a03c6b679d19046d0147d6f77773314eb",
).lower()
MAX_RECORDS = int(os.environ.get("GM_BATCH_RECORDS", "1000"))
MAX_SOURCE_BYTES = int(os.environ.get("GM_BATCH_SOURCE_BYTES", str(10 * 1024 * 1024)))
MAX_RETRIES = int(os.environ.get("GM_IMPORT_RETRIES", "8"))
OIDC_AUDIENCE = os.environ.get("GM_OIDC_AUDIENCE", "partquill-migration")


def fail(message: str) -> None:
    print(f"ERROR: {message}", file=sys.stderr, flush=True)
    raise SystemExit(1)


class AuthorizationProvider:
    def __init__(self) -> None:
        self.token = ""
        self.refresh_at = 0.0
        self.claims_logged = False

    def get(self) -> str:
        if STATIC_TOKEN:
            return STATIC_TOKEN
        if self.token and time.monotonic() < self.refresh_at:
            return self.token

        request_url = os.environ.get("ACTIONS_ID_TOKEN_REQUEST_URL", "")
        request_token = os.environ.get("ACTIONS_ID_TOKEN_REQUEST_TOKEN", "")
        if not request_url or not request_token:
            fail("GitHub OIDC request environment is unavailable")
        separator = "&" if "?" in request_url else "?"
        request = urllib.request.Request(
            f"{request_url}{separator}audience={urllib.parse.quote(OIDC_AUDIENCE)}",
            headers={"Authorization": f"bearer {request_token}"},
        )
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                payload = json.load(response)
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
            fail(f"could not obtain GitHub OIDC token: {error}")
        token = payload.get("value") if isinstance(payload, dict) else None
        if not isinstance(token, str) or token.count(".") != 2:
            fail("GitHub OIDC response did not contain a JWT")

        # Refresh before expiry. GitHub tokens are short-lived; decode only the
        # untrusted expiry hint here because the application verifies the JWT.
        try:
            encoded_payload = token.split(".")[1]
            encoded_payload += "=" * (-len(encoded_payload) % 4)
            claims = json.loads(base64.urlsafe_b64decode(encoded_payload))
            expires_in = max(60, int(claims.get("exp", 0)) - int(time.time()) - 60)
            if not self.claims_logged:
                safe_claims = {
                    key: claims.get(key)
                    for key in (
                        "aud",
                        "event_name",
                        "iss",
                        "job_workflow_ref",
                        "ref",
                        "repository",
                        "repository_id",
                        "repository_owner_id",
                        "sub",
                        "workflow_ref",
                    )
                }
                print(
                    f"OIDC_CLAIMS {json.dumps(safe_claims, sort_keys=True)}",
                    flush=True,
                )
                self.claims_logged = True
        except (ValueError, TypeError, json.JSONDecodeError):
            expires_in = 180
        self.token = token
        self.refresh_at = time.monotonic() + min(expires_in, 240)
        return self.token


AUTHORIZATION = AuthorizationProvider()


def preflight() -> None:
    digest = hashlib.sha256()
    records = 0
    with gzip.open(CATALOG_FILE, "rb") as source:
        for raw_line in source:
            digest.update(raw_line)
            if raw_line.strip():
                records += 1
    actual_sha256 = digest.hexdigest()
    if records != EXPECTED_COUNT:
        fail(f"record count mismatch: expected {EXPECTED_COUNT}, got {records}")
    if actual_sha256 != EXPECTED_SHA256:
        fail(f"uncompressed SHA-256 mismatch: expected {EXPECTED_SHA256}, got {actual_sha256}")
    print(f"PREFLIGHT_OK records={records} sha256={actual_sha256}", flush=True)


def post_batch(records: list[dict], complete: bool, batch_number: int, imported: int) -> None:
    payload = json.dumps(
        {"datasetId": DATASET_ID, "records": records, "complete": complete},
        separators=(",", ":"),
    ).encode("utf-8")

    for attempt in range(1, MAX_RETRIES + 1):
        request = urllib.request.Request(
            f"{BASE_URL}/internal/gm-catalog/import",
            data=payload,
            headers={
                "Authorization": f"Bearer {AUTHORIZATION.get()}",
                "Content-Type": "application/json",
                "User-Agent": "PartQuill-certified-GM-import/1",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=180) as response:
                body = response.read()
                if response.status != 200:
                    raise RuntimeError(f"HTTP {response.status}: {body[:500]!r}")
            print(
                f"batch={batch_number} imported={imported} records={len(records)} "
                f"payload_bytes={len(payload)} complete={str(complete).lower()}",
                flush=True,
            )
            return
        except urllib.error.HTTPError as error:
            detail = error.read(1000).decode("utf-8", "replace")
            if error.code not in {404, 408, 425, 429, 500, 502, 503, 504}:
                fail(f"batch {batch_number} rejected with HTTP {error.code}: {detail}")
            last_error = f"HTTP {error.code}: {detail}"
        except (urllib.error.URLError, TimeoutError, RuntimeError) as error:
            last_error = str(error)

        if attempt == MAX_RETRIES:
            fail(f"batch {batch_number} failed after {MAX_RETRIES} attempts: {last_error}")
        delay = min(60, 2 ** (attempt - 1))
        print(
            f"batch={batch_number} retry={attempt}/{MAX_RETRIES} delay_seconds={delay} "
            f"error={last_error[:300]}",
            flush=True,
        )
        time.sleep(delay)


def import_catalog() -> None:
    batch: list[dict] = []
    batch_source_bytes = 0
    total_records = 0
    posted_records = 0
    batch_number = 0

    with gzip.open(CATALOG_FILE, "rb") as source:
        for raw_line in source:
            if not raw_line.strip():
                continue
            if batch and (
                len(batch) >= MAX_RECORDS
                or batch_source_bytes + len(raw_line) > MAX_SOURCE_BYTES
            ):
                batch_number += 1
                posted_records += len(batch)
                post_batch(batch, False, batch_number, posted_records)
                batch = []
                batch_source_bytes = 0

            try:
                record = json.loads(raw_line)
            except json.JSONDecodeError as error:
                fail(f"invalid NDJSON at record {total_records + 1}: {error}")
            if not isinstance(record, dict) or not record.get("partNumber"):
                fail(f"invalid catalog record at position {total_records + 1}")
            batch.append(record)
            batch_source_bytes += len(raw_line)
            total_records += 1

    if total_records != EXPECTED_COUNT or not batch:
        fail(f"import stream count mismatch: expected {EXPECTED_COUNT}, got {total_records}")
    batch_number += 1
    posted_records += len(batch)
    post_batch(batch, True, batch_number, posted_records)
    print(
        f"IMPORT_COMPLETE dataset={DATASET_ID} records={total_records} "
        f"sha256={EXPECTED_SHA256} batches={batch_number}",
        flush=True,
    )


def main() -> None:
    if not BASE_URL.startswith("https://"):
        fail("PARTQUILL_BASE_URL must be an HTTPS URL")
    if STATIC_TOKEN and len(STATIC_TOKEN) < 32:
        fail("GM_IMPORT_TOKEN is too short")
    if not os.path.isfile(CATALOG_FILE):
        fail(f"catalog file not found: {CATALOG_FILE}")
    preflight()
    import_catalog()


if __name__ == "__main__":
    main()
