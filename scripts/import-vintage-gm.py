#!/usr/bin/env python3
"""Extract the strict-GM Vintage inventory subset and import it into PartQuill.

The generated bundle is private business data. It is intentionally ignored by Git
and must be transmitted only to the owner's protected PartQuill import endpoint.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Iterable


GM_BRANDS = {
    "GM NA",
    "GM FACTORY MOTOR PARTS",
    "GM DIRECT ACCOUNTS",
}
EXPECTED_COLUMNS = [
    "Product Name",
    "SKU",
    "Brand",
    "Description",
    "Quantity",
    "Price",
    "Weight",
]
# Keep legitimate GM alphanumeric keys such as 18E1149. Only hold the explicit
# spreadsheet-style form whose decimal mantissa or signed exponent proves that
# the original integer digits were reformatted and may have been rounded.
SCIENTIFIC_NOTATION = re.compile(r"^[+-]?(?:\d+\.\d+[Ee][+-]?\d+|\d+[Ee][+-]\d+)$")
DECIMAL_VALUE = re.compile(r"^(?:0|[1-9]\d*)(?:\.\d{1,4})?$")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def normalize_sku(value: str) -> tuple[str | None, str, str | None]:
    sku = value.strip()
    if not sku:
        return None, "REJECTED_EMPTY_SKU", "The source SKU is empty."
    if SCIENTIFIC_NOTATION.fullmatch(sku):
        return None, "REJECTED_SCIENTIFIC_NOTATION", "Scientific notation cannot be reversed into an exact OEM key."
    part_number = re.sub(r"[^A-Z0-9]", "", sku.upper())
    if not any(character.isdigit() for character in part_number):
        return None, "REJECTED_NO_DIGIT", "The source SKU has no digit and is not an exact GM part-number key."
    return part_number, "NORMALIZED_EXACT_KEY", None


def source_rows(path: Path) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    source_sha256 = sha256_file(path)
    records: list[dict[str, Any]] = []
    total_rows = 0
    with path.open("r", encoding="utf-8-sig", newline="") as source:
        reader = csv.DictReader(source)
        if reader.fieldnames != EXPECTED_COLUMNS:
            raise ValueError(f"Unexpected CSV columns: {reader.fieldnames!r}")
        for source_row, row in enumerate(reader, start=2):
            total_rows += 1
            brand = row["Brand"].strip()
            if brand not in GM_BRANDS:
                continue
            source_price = row["Price"].strip()
            source_weight = row["Weight"].strip()
            if not DECIMAL_VALUE.fullmatch(source_price):
                raise ValueError(f"Invalid source price at CSV row {source_row}: {source_price!r}")
            if not DECIMAL_VALUE.fullmatch(source_weight):
                raise ValueError(f"Invalid source weight at CSV row {source_row}: {source_weight!r}")
            try:
                quantity = int(row["Quantity"].strip())
            except ValueError as error:
                raise ValueError(f"Invalid quantity at CSV row {source_row}: {row['Quantity']!r}") from error
            if quantity < 0:
                raise ValueError(f"Negative quantity at CSV row {source_row}")
            part_number, normalization_state, normalization_issue = normalize_sku(row["SKU"])
            records.append({
                "sourceRow": source_row,
                "productName": row["Product Name"].strip(),
                "sku": row["SKU"].strip(),
                "partNumber": part_number,
                "brand": brand,
                "description": row["Description"].strip(),
                "quantity": quantity,
                "sourcePrice": source_price,
                "sourceWeight": source_weight,
                "normalizationState": normalization_state,
                "normalizationIssue": normalization_issue,
            })
    manifest = {
        "type": "partquill-vintage-gm-bundle",
        "version": 1,
        "datasetId": f"vintage-gm-{source_sha256[:16]}-v1",
        "sourceSha256": source_sha256,
        "sourceFileName": path.name,
        "sourceTotalRows": total_rows,
        "expectedGmRows": len(records),
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
            raise ValueError("The Vintage GM bundle is empty")
        manifest = json.loads(first_line)
        if manifest.get("type") != "partquill-vintage-gm-bundle" or manifest.get("version") != 1:
            raise ValueError("The input is not a supported PartQuill Vintage GM bundle")
        records = [json.loads(line) for line in source if line.strip()]
    if len(records) != manifest.get("expectedGmRows"):
        raise ValueError(
            f"Bundle row count mismatch: expected {manifest.get('expectedGmRows')}, found {len(records)}"
        )
    return manifest, records


def chunks(records: list[dict[str, Any]], size: int) -> Iterable[list[dict[str, Any]]]:
    for offset in range(0, len(records), size):
        yield records[offset:offset + size]


def post_batch(endpoint: str, token: str, payload: dict[str, Any]) -> dict[str, Any]:
    target = endpoint.rstrip("/") + "/internal/vintage-gm/import"
    request = urllib.request.Request(
        target,
        data=json.dumps(payload, separators=(",", ":")).encode("utf-8"),
        headers={
            "authorization": f"Bearer {token}",
            "content-type": "application/json",
            "user-agent": "PartQuill-Vintage-GM-Importer/1.0",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=90) as response:
            return json.loads(response.read())
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")[:2000]
        raise RuntimeError(f"PartQuill import returned HTTP {error.code}: {detail}") from error


def upload(
    endpoint: str,
    token: str,
    manifest: dict[str, Any],
    records: list[dict[str, Any]],
    batch_size: int,
) -> dict[str, Any]:
    batches = list(chunks(records, batch_size))
    final_response: dict[str, Any] = {}
    for index, batch in enumerate(batches, start=1):
        payload = {
            "datasetId": manifest["datasetId"],
            "sourceSha256": manifest["sourceSha256"],
            "sourceFileName": manifest["sourceFileName"],
            "sourceTotalRows": manifest["sourceTotalRows"],
            "expectedGmRows": manifest["expectedGmRows"],
            "records": batch,
            "complete": index == len(batches),
        }
        final_response = post_batch(endpoint, token, payload)
        print(
            f"Imported batch {index}/{len(batches)} ({len(batch)} rows); "
            f"active={final_response.get('status', {}).get('active', False)}",
            file=sys.stderr,
        )
    return final_response


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--csv", type=Path, help="Original Products_Vintage CSV")
    source.add_argument("--bundle", type=Path, help="Previously generated private GM-only JSONL bundle")
    parser.add_argument("--output", type=Path, help="Write a private GM-only JSONL bundle")
    parser.add_argument("--endpoint", help="PartQuill origin, such as https://partquill.com")
    parser.add_argument(
        "--token-env",
        default="PARTQUILL_GM_IMPORT_TOKEN",
        help="Environment variable holding the private import token",
    )
    parser.add_argument("--batch-size", type=int, default=750)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if not 1 <= args.batch_size <= 1000:
        raise ValueError("--batch-size must be between 1 and 1000")
    if args.csv:
        manifest, records = source_rows(args.csv.resolve())
    else:
        manifest, records = read_bundle(args.bundle.resolve())
    if args.output:
        write_bundle(args.output.resolve(), manifest, records)

    result: dict[str, Any] = {
        "datasetId": manifest["datasetId"],
        "sourceSha256": manifest["sourceSha256"],
        "sourceFileName": manifest["sourceFileName"],
        "sourceTotalRows": manifest["sourceTotalRows"],
        "gmRows": manifest["expectedGmRows"],
        "normalizedRows": sum(record["partNumber"] is not None for record in records),
        "rejectedRows": sum(record["partNumber"] is None for record in records),
        "brands": sorted({record["brand"] for record in records}),
        "bundleWritten": str(args.output.resolve()) if args.output else None,
        "uploaded": False,
    }
    if args.endpoint:
        token = os.environ.get(args.token_env)
        if not token:
            raise ValueError(f"{args.token_env} is required when --endpoint is used")
        response = upload(args.endpoint, token, manifest, records, args.batch_size)
        result["uploaded"] = True
        result["serverStatus"] = response.get("status")
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
