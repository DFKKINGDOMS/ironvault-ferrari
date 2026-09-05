#!/usr/bin/env python3
"""Validate and import a private seller active-listing snapshot into PartQuill.

Only fields needed for read-only seller evidence are retained. Marketplace item
IDs, buyer data, and unrelated report columns are never sent to PartQuill.
"""

from __future__ import annotations

import argparse
import base64
import csv
import gzip
import hashlib
import io
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Iterable, TextIO


EXPECTED_COLUMNS = [
    "Item number", "Title", "Variation details", "Custom label (SKU)",
    "Available quantity", "Format", "Currency", "Start price",
    "Auction Buy It Now price", "Reserve price", "Current price",
    "Sold quantity", "Watchers", "Bids", "Start date", "End date",
    "eBay category 1 name", "eBay category 1 number", "eBay category 2 name",
    "eBay category 2 number", "Condition", "CD:Professional Grader - (ID: 27501)",
    "CD:Grade - (ID: 27502)", "CDA:Certification Number - (ID: 27503)",
    "CD:Card Condition - (ID: 40001)", "eBay Product ID(ePID)",
    "Listing site", "P:UPC", "P:EAN", "P:ISBN",
]
SCIENTIFIC_NOTATION = re.compile(r"^[+-]?(?:\d+\.\d+[Ee][+-]?\d+|\d+[Ee][+-]\d+)$")
DECIMAL_VALUE = re.compile(r"^(?:0|[1-9]\d*)(?:\.\d{1,4})?$")
SNAPSHOT_IN_NAME = re.compile(r"(?<!\d)(20\d{2})[-_](\d{2})[-_](\d{2})(?!\d)")
OIDC_AUDIENCE = os.environ.get("SELLER_LISTING_OIDC_AUDIENCE", "partquill-migration")
MAX_RETRIES = int(os.environ.get("SELLER_LISTING_IMPORT_RETRIES", "8"))


def fail(message: str) -> None:
    print(f"ERROR: {message}", file=sys.stderr, flush=True)
    raise SystemExit(1)


def open_text(path: Path) -> TextIO:
    if path.suffix.lower() == ".gz":
        return io.TextIOWrapper(gzip.open(path, "rb"), encoding="utf-8-sig", newline="")
    return path.open("r", encoding="utf-8-sig", newline="")


def uncompressed_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    opener = gzip.open if path.suffix.lower() == ".gz" else open
    with opener(path, "rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def normalize_sku(value: str) -> tuple[str | None, str, str | None]:
    sku = value.strip()
    if not sku:
        return None, "REJECTED_EMPTY_SKU", "The source SKU is empty."
    if SCIENTIFIC_NOTATION.fullmatch(sku):
        return None, "REJECTED_SCIENTIFIC_NOTATION", "Scientific notation cannot be reversed into an exact seller key."
    part_number = re.sub(r"[^A-Z0-9]", "", sku.upper())
    if not any(character.isdigit() for character in part_number):
        return None, "REJECTED_NO_DIGIT", "The source SKU has no digit and is not an exact part-number key."
    return part_number, "NORMALIZED_EXACT_KEY", None


def parse_nonnegative_integer(value: str, label: str, source_row: int) -> int:
    try:
        parsed = int(value.strip() or "0")
    except ValueError as error:
        raise ValueError(f"Invalid {label} at CSV row {source_row}") from error
    if parsed < 0:
        raise ValueError(f"Negative {label} at CSV row {source_row}")
    return parsed


def source_rows(path: Path, snapshot_date: str | None) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    records: list[dict[str, Any]] = []
    total_rows = 0
    with open_text(path) as source:
        reader = csv.DictReader(source)
        if reader.fieldnames != EXPECTED_COLUMNS:
            raise ValueError("Unexpected active-listing CSV columns")
        for source_row, row in enumerate(reader, start=2):
            total_rows += 1
            part_number, normalization_state, normalization_issue = normalize_sku(row["Custom label (SKU)"])
            asking_price = (row["Current price"] or row["Start price"]).strip()
            if not DECIMAL_VALUE.fullmatch(asking_price):
                raise ValueError(f"Invalid asking price at CSV row {source_row}")
            currency = row["Currency"].strip().upper()
            if not re.fullmatch(r"[A-Z]{3}", currency):
                raise ValueError(f"Invalid currency at CSV row {source_row}")
            records.append({
                "sourceRow": source_row,
                "sku": row["Custom label (SKU)"].strip(),
                "partNumber": part_number,
                "title": row["Title"].strip(),
                "availableQuantity": parse_nonnegative_integer(row["Available quantity"], "available quantity", source_row),
                "soldQuantity": parse_nonnegative_integer(row["Sold quantity"], "sold quantity", source_row),
                "currency": currency,
                "askingPrice": asking_price,
                "condition": row["Condition"].strip(),
                "normalizationState": normalization_state,
                "normalizationIssue": normalization_issue,
            })
    if not snapshot_date:
        match = SNAPSHOT_IN_NAME.search(path.name)
        if not match:
            raise ValueError("--snapshot-date is required when the source filename has no YYYY-MM-DD date")
        snapshot_date = "-".join(match.groups())
    if not re.fullmatch(r"20\d{2}-\d{2}-\d{2}", snapshot_date):
        raise ValueError("snapshot date must be YYYY-MM-DD")
    source_sha256 = uncompressed_sha256(path)
    source_name = path.name[:-3] if path.name.lower().endswith(".gz") else path.name
    manifest = {
        "type": "partquill-seller-listing-bundle",
        "version": 1,
        "datasetId": f"seller-listings-{snapshot_date}-{source_sha256[:16]}-v1",
        "sourceSha256": source_sha256,
        "sourceFileName": source_name,
        "snapshotDate": snapshot_date,
        "sourceTotalRows": total_rows,
        "expectedRows": len(records),
    }
    return manifest, records


def write_bundle(path: Path, manifest: dict[str, Any], records: Iterable[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as target:
        target.write(json.dumps(manifest, separators=(",", ":"), ensure_ascii=True) + "\n")
        for record in records:
            target.write(json.dumps(record, separators=(",", ":"), ensure_ascii=True) + "\n")


def read_bundle(path: Path) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    with path.open("r", encoding="utf-8") as source:
        first_line = source.readline()
        if not first_line:
            raise ValueError("The seller listing bundle is empty")
        manifest = json.loads(first_line)
        if manifest.get("type") != "partquill-seller-listing-bundle" or manifest.get("version") != 1:
            raise ValueError("The input is not a supported PartQuill seller listing bundle")
        records = [json.loads(line) for line in source if line.strip()]
    if len(records) != manifest.get("expectedRows"):
        raise ValueError("Seller listing bundle row count mismatch")
    return manifest, records


class AuthorizationProvider:
    def __init__(self, static_token: str) -> None:
        self.static_token = static_token
        self.token = ""
        self.refresh_at = 0.0

    def get(self) -> str:
        if self.static_token:
            return self.static_token
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
        with urllib.request.urlopen(request, timeout=30) as response:
            payload = json.load(response)
        token = payload.get("value") if isinstance(payload, dict) else None
        if not isinstance(token, str) or token.count(".") != 2:
            fail("GitHub OIDC response did not contain a JWT")
        try:
            encoded = token.split(".")[1] + "==="
            claims = json.loads(base64.urlsafe_b64decode(encoded))
            refresh_seconds = max(60, int(claims.get("exp", 0)) - int(time.time()) - 60)
        except (ValueError, TypeError, json.JSONDecodeError):
            refresh_seconds = 180
        self.token = token
        self.refresh_at = time.monotonic() + min(refresh_seconds, 240)
        return token


def chunks(records: list[dict[str, Any]], size: int) -> Iterable[list[dict[str, Any]]]:
    for offset in range(0, len(records), size):
        yield records[offset:offset + size]


def post_batch(endpoint: str, authorization: AuthorizationProvider, payload: dict[str, Any]) -> dict[str, Any]:
    body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    last_error = "unknown error"
    for attempt in range(1, MAX_RETRIES + 1):
        request = urllib.request.Request(
            endpoint.rstrip("/") + "/internal/seller-listings/import",
            data=body,
            headers={
                "authorization": f"Bearer {authorization.get()}",
                "content-type": "application/json",
                "user-agent": "PartQuill-Seller-Listing-Importer/1.0",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=180) as response:
                return json.loads(response.read())
        except urllib.error.HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")[:1000]
            if error.code not in {404, 408, 425, 429, 500, 502, 503, 504}:
                raise RuntimeError(f"PartQuill import returned HTTP {error.code}: {detail}") from error
            last_error = f"HTTP {error.code}: {detail}"
        except (urllib.error.URLError, TimeoutError) as error:
            last_error = str(error)
        if attempt == MAX_RETRIES:
            raise RuntimeError(f"PartQuill import failed after {MAX_RETRIES} attempts: {last_error}")
        delay = min(60, 2 ** (attempt - 1))
        print(f"retry={attempt}/{MAX_RETRIES} delay_seconds={delay}", file=sys.stderr, flush=True)
        time.sleep(delay)
    raise RuntimeError(last_error)


def upload(endpoint: str, token: str, manifest: dict[str, Any], records: list[dict[str, Any]], batch_size: int) -> dict[str, Any]:
    authorization = AuthorizationProvider(token)
    batches = list(chunks(records, batch_size))
    final_response: dict[str, Any] = {}
    for index, batch in enumerate(batches, start=1):
        payload = {**manifest, "records": batch, "complete": index == len(batches)}
        payload.pop("type", None)
        payload.pop("version", None)
        final_response = post_batch(endpoint, authorization, payload)
        print(f"Imported batch {index}/{len(batches)} ({len(batch)} rows)", file=sys.stderr, flush=True)
    return final_response


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--csv", type=Path, help="Original active-listing CSV or deterministic gzip")
    source.add_argument("--bundle", type=Path, help="Previously generated private JSONL bundle")
    parser.add_argument("--snapshot-date", help="Snapshot date, YYYY-MM-DD; otherwise derived from filename")
    parser.add_argument("--expected-sha256", help="Required uncompressed source SHA-256")
    parser.add_argument("--output", type=Path, help="Write a private sanitized JSONL bundle")
    parser.add_argument("--endpoint", help="PartQuill HTTPS origin")
    parser.add_argument("--token-env", default="PARTQUILL_GM_IMPORT_TOKEN")
    parser.add_argument("--batch-size", type=int, default=750)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if not 1 <= args.batch_size <= 1000:
        raise ValueError("--batch-size must be between 1 and 1000")
    if args.csv:
        manifest, records = source_rows(args.csv.resolve(), args.snapshot_date)
    else:
        manifest, records = read_bundle(args.bundle.resolve())
    if args.expected_sha256 and manifest["sourceSha256"] != args.expected_sha256.lower():
        raise ValueError("uncompressed source SHA-256 does not match the approved value")
    if args.output:
        write_bundle(args.output.resolve(), manifest, records)
    result: dict[str, Any] = {
        "datasetId": manifest["datasetId"],
        "sourceSha256": manifest["sourceSha256"],
        "snapshotDate": manifest["snapshotDate"],
        "sourceTotalRows": manifest["sourceTotalRows"],
        "expectedRows": manifest["expectedRows"],
        "normalizedRows": sum(record["partNumber"] is not None for record in records),
        "rejectedRows": sum(record["partNumber"] is None for record in records),
        "bundleWritten": str(args.output.resolve()) if args.output else None,
        "uploaded": False,
    }
    if args.endpoint:
        if not args.endpoint.startswith("https://"):
            raise ValueError("--endpoint must be HTTPS")
        response = upload(args.endpoint, os.environ.get(args.token_env, ""), manifest, records, args.batch_size)
        result["uploaded"] = True
        result["serverStatus"] = response.get("status")
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
