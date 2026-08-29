#!/usr/bin/env python3
"""Copy GMPartsWiki page scans with resumable Azure Blob checkpoints."""

from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
import json
import os
from pathlib import Path
import random
import subprocess
import tempfile
import time
from dataclasses import dataclass
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
MAX_IMAGE_BYTES = 20 * 1024 * 1024


@dataclass(frozen=True)
class DownloadedScan:
    page_id: int
    path: Path
    size: int
    sha256: str


class DownloadFailure(RuntimeError):
    pass


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--checkpoint", type=Path, required=True)
    parser.add_argument("--failures", type=Path, required=True)
    parser.add_argument("--account", required=True)
    parser.add_argument("--container", required=True)
    parser.add_argument("--prefix", default="gm-scans/pages")
    parser.add_argument("--checkpoint-blob", required=True)
    parser.add_argument("--failures-blob", required=True)
    parser.add_argument("--shard-index", type=int, required=True)
    parser.add_argument("--shard-count", type=int, required=True)
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--batch-size", type=int, default=128)
    parser.add_argument("--attempts", type=int, default=5)
    parser.add_argument("--source-base-url", default="http://gmpartswiki.com/getbigpage?pageid=")
    return parser.parse_args()


def read_page_ids(path: Path) -> list[int]:
    page_ids = sorted({int(line.strip()) for line in path.read_text().splitlines() if line.strip()})
    if not page_ids:
        raise ValueError("page manifest is empty")
    return page_ids


def read_completed(path: Path) -> set[int]:
    if not path.exists():
        return set()
    completed: set[int] = set()
    for line in path.read_text().splitlines():
        if not line.strip():
            continue
        completed.add(int(line.split("\t", 1)[0]))
    return completed


def download_scan(page_id: int, target_root: Path, source_base_url: str, attempts: int) -> DownloadedScan:
    url = f"{source_base_url}{page_id}"
    last_error = "unknown error"
    for attempt in range(1, attempts + 1):
        try:
            request = Request(
                url,
                headers={
                    "Accept": "image/png,image/*;q=0.8",
                    "User-Agent": "PartQuill-Azure-Migration/1.0 (+https://partquill.com)",
                },
            )
            with urlopen(request, timeout=45) as response:
                payload = response.read(MAX_IMAGE_BYTES + 1)
                content_type = response.headers.get_content_type()
            if len(payload) > MAX_IMAGE_BYTES:
                raise DownloadFailure(f"image exceeds {MAX_IMAGE_BYTES} bytes")
            if not payload.startswith(PNG_SIGNATURE):
                raise DownloadFailure(f"response is not PNG ({content_type})")
            page_folder = str(page_id).zfill(6)
            output = target_root / page_folder / "full_page.png"
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_bytes(payload)
            return DownloadedScan(page_id, output, len(payload), hashlib.sha256(payload).hexdigest())
        except HTTPError as error:
            last_error = f"HTTP {error.code}"
            if error.code not in {408, 425, 429, 500, 502, 503, 504}:
                break
        except (URLError, TimeoutError, OSError, DownloadFailure) as error:
            last_error = str(error)
        if attempt < attempts:
            time.sleep(min(20.0, (2 ** (attempt - 1)) + random.random()))
    raise DownloadFailure(f"page {page_id}: {last_error}")


def run_az(command: list[str]) -> None:
    subprocess.run(
        ["az", *command, "--only-show-errors", "--output", "none"],
        check=True,
        env=os.environ.copy(),
    )


def upload_batch(args: argparse.Namespace, source: Path) -> None:
    run_az([
        "storage", "blob", "upload-batch",
        "--account-name", args.account,
        "--auth-mode", "key",
        "--destination", args.container,
        "--source", str(source),
        "--destination-path", args.prefix.strip("/"),
        "--overwrite", "true",
        "--content-type", "image/png",
        "--max-connections", str(args.workers),
    ])


def upload_state(args: argparse.Namespace, local_path: Path, blob_name: str) -> None:
    run_az([
        "storage", "blob", "upload",
        "--account-name", args.account,
        "--auth-mode", "key",
        "--container-name", args.container,
        "--file", str(local_path),
        "--name", blob_name,
        "--overwrite", "true",
    ])


def append_failures(path: Path, shard: int, failures: list[tuple[int, str]]) -> None:
    with path.open("a", encoding="utf-8") as handle:
        for page_id, error in failures:
            handle.write(json.dumps({
                "pageId": page_id,
                "shard": shard,
                "error": error,
                "recordedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            }, separators=(",", ":")) + "\n")


def main() -> int:
    args = parse_args()
    if not 0 <= args.shard_index < args.shard_count:
        raise ValueError("shard index must be within the shard count")
    if not 1 <= args.workers <= 16:
        raise ValueError("workers must be between 1 and 16")
    if not os.environ.get("AZURE_STORAGE_KEY"):
        raise ValueError("AZURE_STORAGE_KEY is required")

    args.checkpoint.parent.mkdir(parents=True, exist_ok=True)
    args.failures.parent.mkdir(parents=True, exist_ok=True)
    args.checkpoint.touch(exist_ok=True)
    args.failures.write_text("")

    completed = read_completed(args.checkpoint)
    shard_pages = [
        page_id for page_id in read_page_ids(args.manifest)
        if page_id % args.shard_count == args.shard_index
    ]
    pending = [page_id for page_id in shard_pages if page_id not in completed]
    print(
        f"SHARD_START shard={args.shard_index}/{args.shard_count} "
        f"assigned={len(shard_pages)} completed={len(completed)} pending={len(pending)}",
        flush=True,
    )

    failed_count = 0
    for offset in range(0, len(pending), args.batch_size):
        page_batch = pending[offset:offset + args.batch_size]
        batch_failures: list[tuple[int, str]] = []
        downloaded: list[DownloadedScan] = []
        with tempfile.TemporaryDirectory(prefix=f"partquill-scan-{args.shard_index:02d}-") as temp_dir:
            target_root = Path(temp_dir)
            with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as executor:
                futures = {
                    executor.submit(
                        download_scan,
                        page_id,
                        target_root,
                        args.source_base_url,
                        args.attempts,
                    ): page_id
                    for page_id in page_batch
                }
                for future in concurrent.futures.as_completed(futures):
                    page_id = futures[future]
                    try:
                        downloaded.append(future.result())
                    except Exception as error:  # Keep the shard moving and retry failures next run.
                        batch_failures.append((page_id, str(error)))

            if downloaded:
                upload_batch(args, target_root)
                with args.checkpoint.open("a", encoding="utf-8") as handle:
                    for scan in sorted(downloaded, key=lambda item: item.page_id):
                        handle.write(f"{scan.page_id}\t{scan.size}\t{scan.sha256}\n")
                    handle.flush()
                    os.fsync(handle.fileno())
                upload_state(args, args.checkpoint, args.checkpoint_blob)

        if batch_failures:
            failed_count += len(batch_failures)
            append_failures(args.failures, args.shard_index, batch_failures)
            upload_state(args, args.failures, args.failures_blob)

        completed_now = min(len(shard_pages), len(completed) + offset + len(page_batch) - failed_count)
        print(
            f"SHARD_PROGRESS shard={args.shard_index} completed={completed_now}/{len(shard_pages)} "
            f"uploaded={len(downloaded)} failures={len(batch_failures)}",
            flush=True,
        )

    final_completed = len(read_completed(args.checkpoint))
    print(
        f"SHARD_FINISH shard={args.shard_index} completed={final_completed}/{len(shard_pages)} "
        f"failures={failed_count}",
        flush=True,
    )
    return 0 if final_completed == len(shard_pages) else 2


if __name__ == "__main__":
    raise SystemExit(main())
