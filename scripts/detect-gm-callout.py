#!/usr/bin/env python3
"""Detect an exact GM catalog table row and its numbered diagram callouts.

The source scan is read from stdin. JSON is written to stdout so the Node
service can keep the original scan immutable and render a controlled overlay.
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import math
import re
import subprocess
import sys
from dataclasses import dataclass

import numpy as np
from PIL import Image, ImageOps


@dataclass(frozen=True)
class OcrWord:
    text: str
    confidence: float
    left: int
    top: int
    width: int
    height: int
    block: int
    paragraph: int
    line: int


def run_tesseract(image: Image.Image, page_segmentation: int, whitelist: str | None = None) -> list[OcrWord]:
    payload = io.BytesIO()
    image.save(payload, format="PNG", optimize=True)
    command = ["tesseract", "stdin", "stdout", "--psm", str(page_segmentation), "tsv"]
    if whitelist:
        command.extend(["-c", f"tessedit_char_whitelist={whitelist}"])
    result = subprocess.run(
        command,
        input=payload.getvalue(),
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        check=True,
        timeout=45,
    )
    rows = csv.DictReader(io.StringIO(result.stdout.decode("utf-8", errors="replace")), delimiter="\t")
    words: list[OcrWord] = []
    for row in rows:
        text = (row.get("text") or "").strip()
        if not text:
            continue
        try:
            words.append(
                OcrWord(
                    text=text,
                    confidence=float(row.get("conf") or -1),
                    left=int(row.get("left") or 0),
                    top=int(row.get("top") or 0),
                    width=int(row.get("width") or 0),
                    height=int(row.get("height") or 0),
                    block=int(row.get("block_num") or 0),
                    paragraph=int(row.get("par_num") or 0),
                    line=int(row.get("line_num") or 0),
                )
            )
        except ValueError:
            continue
    return words


def canonical_number(value: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", value.upper()).replace("O", "0")


def row_metadata(image: Image.Image, part_number: str) -> dict[str, object] | None:
    width, height = image.size
    crop_top = int(height * 0.69)
    table = image.crop((0, crop_top, width, height))
    words = run_tesseract(table, 6)
    grouped: dict[tuple[int, int, int], list[OcrWord]] = {}
    for word in words:
        grouped.setdefault((word.block, word.paragraph, word.line), []).append(word)

    requested = canonical_number(part_number)
    for line_words in grouped.values():
        ordered = sorted(line_words, key=lambda word: word.left)
        part_index = next(
            (
                index
                for index, word in enumerate(ordered)
                if canonical_number(word.text) == requested and word.confidence >= 40
            ),
            None,
        )
        if part_index is None:
            continue
        callout_index = next(
            (
                index
                for index, word in enumerate(ordered[:part_index])
                if re.fullmatch(r"\d{1,3}[.)]?", word.text)
            ),
            None,
        )
        if callout_index is None:
            continue
        callout = re.sub(r"\D", "", ordered[callout_index].text)
        if not callout or int(callout) > 999:
            continue
        group_index = next(
            (
                index
                for index, word in enumerate(ordered[callout_index + 1 : part_index], callout_index + 1)
                if re.fullmatch(r"['\u2018\u2019]?\d{1,2}[.]\d{2,4}", word.text)
            ),
            None,
        )
        description_start = (group_index + 1) if group_index is not None else callout_index + 1
        description_words = [word for word in ordered[description_start:part_index] if word.confidence >= 35]
        description = " ".join(word.text for word in description_words)
        description = re.sub(r"\s+([,.;:)])", r"\1", description)
        description = re.sub(r"([(])\s+", r"\1", description)
        left = min(word.left for word in ordered)
        top = min(word.top for word in ordered) + crop_top
        right = max(word.left + word.width for word in ordered)
        bottom = max(word.top + word.height for word in ordered) + crop_top
        return {
            "calloutId": callout,
            "catalogGroup": ordered[group_index].text.lstrip("'\u2018\u2019") if group_index is not None else None,
            "description": description or None,
            "rowBox": {
                "left": left,
                "top": top,
                "width": right - left,
                "height": bottom - top,
                "image_width": width,
                "image_height": height,
            },
            "rowConfidence": round(
                min(
                    1.0,
                    sum(max(0.0, word.confidence) for word in [ordered[callout_index], ordered[part_index], *description_words])
                    / (100 * max(1, len(description_words) + 2)),
                ),
                4,
            ),
        }
    return None


def dilate(mask: np.ndarray, radius: int = 1) -> np.ndarray:
    result = mask.copy()
    for delta_y in range(-radius, radius + 1):
        for delta_x in range(-radius, radius + 1):
            if not delta_x and not delta_y:
                continue
            shifted = np.zeros_like(mask)
            source_y_start = max(0, -delta_y)
            source_y_end = mask.shape[0] - max(0, delta_y)
            source_x_start = max(0, -delta_x)
            source_x_end = mask.shape[1] - max(0, delta_x)
            target_y_start = max(0, delta_y)
            target_y_end = mask.shape[0] - max(0, -delta_y)
            target_x_start = max(0, delta_x)
            target_x_end = mask.shape[1] - max(0, -delta_x)
            shifted[target_y_start:target_y_end, target_x_start:target_x_end] = mask[
                source_y_start:source_y_end, source_x_start:source_x_end
            ]
            result |= shifted
    return result


def circle_candidates(image: Image.Image) -> list[tuple[int, int, int, float]]:
    original_width, original_height = image.size
    scale = min(1.0, 1400 / original_width)
    reduced_width = max(1, round(original_width * scale))
    reduced_height = max(1, round(original_height * scale))
    gray = ImageOps.grayscale(image).resize((reduced_width, reduced_height), Image.Resampling.LANCZOS)
    pixels = np.asarray(gray)
    dark = dilate(pixels < 145, 1)
    diagram_height = int(reduced_height * 0.70)
    dark = dark[:diagram_height, :]
    max_radius = max(11, round(reduced_width * 0.0155))
    min_radius = max(7, round(reduced_width * 0.0075))
    margin = max_radius + 3
    if dark.shape[0] <= margin * 2 or dark.shape[1] <= margin * 2:
        return []
    core_height = dark.shape[0] - margin * 2
    core_width = dark.shape[1] - margin * 2
    detected: list[tuple[int, int, int, float]] = []
    angle_count = 24
    for radius in range(min_radius, max_radius + 1):
        score = np.zeros((core_height, core_width), dtype=np.uint8)
        offsets = {
            (round(math.cos(2 * math.pi * index / angle_count) * radius), round(math.sin(2 * math.pi * index / angle_count) * radius))
            for index in range(angle_count)
        }
        for delta_x, delta_y in offsets:
            score += dark[
                margin + delta_y : margin + delta_y + core_height,
                margin + delta_x : margin + delta_x + core_width,
            ]
        threshold = max(14, math.ceil(len(offsets) * 0.74))
        flat = np.flatnonzero(score >= threshold)
        if not flat.size:
            continue
        if flat.size > 600:
            ranked = np.argpartition(score.ravel()[flat], -600)[-600:]
            flat = flat[ranked]
        flat = flat[np.argsort(score.ravel()[flat])[::-1]]
        for flat_index in flat:
            y, x = np.unravel_index(flat_index, score.shape)
            center_x = int(x + margin)
            center_y = int(y + margin)
            inner_radius = max(2, round(radius * 0.58))
            inner = pixels[
                max(0, center_y - inner_radius) : center_y + inner_radius + 1,
                max(0, center_x - inner_radius) : center_x + inner_radius + 1,
            ]
            if not inner.size:
                continue
            inner_dark_ratio = float(np.mean(inner < 145))
            if inner_dark_ratio > 0.27:
                continue
            outer_radius = round(radius * 1.35)
            outer_offsets = {
                (round(math.cos(2 * math.pi * index / angle_count) * outer_radius), round(math.sin(2 * math.pi * index / angle_count) * outer_radius))
                for index in range(angle_count)
            }
            outer_dark = sum(
                bool(dark[center_y + delta_y, center_x + delta_x])
                for delta_x, delta_y in outer_offsets
                if 0 <= center_y + delta_y < dark.shape[0] and 0 <= center_x + delta_x < dark.shape[1]
            ) / max(1, len(outer_offsets))
            if outer_dark > 0.42:
                continue
            detected.append((center_x, center_y, radius, float(score.ravel()[flat_index] / len(offsets))))
            if len(detected) >= 3000:
                break
    accepted: list[tuple[int, int, int, float]] = []
    for center_x, center_y, radius, confidence in sorted(detected, key=lambda candidate: (candidate[3], candidate[2]), reverse=True):
        if any(
            (center_x - prior_x) ** 2 + (center_y - prior_y) ** 2 < (max(radius, prior_radius) * 0.9) ** 2
            for prior_x, prior_y, prior_radius, _ in accepted
        ):
            continue
        accepted.append((center_x, center_y, radius, confidence))
        if len(accepted) >= 240:
            break
    return [
        (round(x / scale), round(y / scale), round(radius / scale), confidence)
        for x, y, radius, confidence in accepted
    ]


def identify_callouts(
    image: Image.Image, candidates: list[tuple[int, int, int, float]], callout_id: str
) -> tuple[list[dict[str, object]], list[dict[str, object]]]:
    if not candidates:
        return [], []

    cell_size = 128
    crop_size = 88
    readings_by_index: dict[int, list[str]] = {index: [] for index in range(len(candidates))}
    for thresholded in (False, True):
        montage = Image.new("L", (cell_size, len(candidates) * cell_size), color=255)
        for index, (center_x, center_y, radius, _) in enumerate(candidates):
            inner_radius = max(5, round(radius * 0.65))
            crop = ImageOps.autocontrast(
                ImageOps.grayscale(
                    image.crop(
                        (
                            center_x - inner_radius,
                            center_y - inner_radius,
                            center_x + inner_radius + 1,
                            center_y + inner_radius + 1,
                        )
                    )
                )
            ).resize((crop_size, crop_size), Image.Resampling.LANCZOS)
            if thresholded:
                crop = crop.point(lambda pixel: 255 if pixel > 178 else 0)
            montage.paste(crop, ((cell_size - crop_size) // 2, index * cell_size + (cell_size - crop_size) // 2))
        for page_segmentation in (6, 11):
            for word in run_tesseract(montage, page_segmentation, "0123456789"):
                index = int((word.top + word.height / 2) // cell_size)
                value = re.sub(r"\D", "", word.text)
                if 0 <= index < len(candidates) and value:
                    readings_by_index[index].append(value)
    readings = sorted(readings_by_index.items())
    matched: list[dict[str, object]] = []
    recognized: list[dict[str, object]] = []
    for index, values in readings:
        if values:
            recognized.append({"values": values, "candidateIndex": index})
        matching_reads = sum(value == callout_id for value in values)
        if not matching_reads:
            continue
        candidate_x, candidate_y, radius, ring_confidence = candidates[index]
        pad = max(5, round(radius * 0.28))
        matched.append(
            {
                "left": max(0, candidate_x - radius - pad),
                "top": max(0, candidate_y - radius - pad),
                "width": (radius + pad) * 2,
                "height": (radius + pad) * 2,
                "image_width": image.width,
                "image_height": image.height,
                "confidence": round(min(1.0, ring_confidence * (0.95 if matching_reads > 1 else 0.76)), 4),
            }
        )
    return matched, recognized


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--part-number", required=True)
    parser.add_argument("--callout-id")
    parser.add_argument("--debug", action="store_true")
    args = parser.parse_args()
    image = Image.open(io.BytesIO(sys.stdin.buffer.read())).convert("L")
    row = row_metadata(image, args.part_number)
    callout_id = args.callout_id or (str(row["calloutId"]) if row else None)
    callout_boxes: list[dict[str, object]] = []
    recognized: list[dict[str, object]] = []
    candidates: list[tuple[int, int, int, float]] = []
    if callout_id:
        candidates = circle_candidates(image)
        callout_boxes, recognized = identify_callouts(image, candidates, callout_id)
    result = {
        "state": "EXACT_ROW_AND_CALLOUT" if row and callout_boxes else "EXACT_ROW_ONLY" if row else "NOT_RESOLVED",
        "partNumber": canonical_number(args.part_number),
        "calloutId": callout_id,
        "catalogGroup": row.get("catalogGroup") if row else None,
        "description": row.get("description") if row else None,
        "rowBox": row.get("rowBox") if row else None,
        "rowConfidence": row.get("rowConfidence") if row else 0,
        "calloutBoxes": callout_boxes,
    }
    if args.debug:
        result["candidateCount"] = len(candidates)
        result["candidates"] = candidates
        result["recognized"] = recognized
    print(json.dumps(result, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
