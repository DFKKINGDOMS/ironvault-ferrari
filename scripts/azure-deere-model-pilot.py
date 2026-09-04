#!/usr/bin/env python3
"""Azure-only, approval-gated Deere model collection image pilot.

This process cannot write to Shopify. It creates five review candidates, applies
deterministic monochrome/background/geometry gates, asks Azure GPT-5 mini for a
strict visual review, and writes a manifest plus PASS images for Azure Blob.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import io
import json
import os
import time
import urllib.request
from pathlib import Path

import requests
from PIL import Image


def azure_endpoint(root: str, path: str) -> str:
    root = root.rstrip("/")
    if not root.endswith("/openai/v1"):
        root += "/openai/v1"
    return f"{root}/{path.lstrip('/')}"


def azure_headers(key: str) -> dict[str, str]:
    return {"api-key": key, "content-type": "application/json"}


def prompt_for(row: dict) -> str:
    return f"""Create a square, high-resolution technical equipment illustration for the verified model {row['model']}.

Verified machine configuration: {row['machineType']}.

LOCKED COMPOSITION: exactly one large, mechanically plausible standalone machine, centered and filling most of the square canvas, with generous even white margins. Show the complete machine without cropping. Use a clean three-quarter view that exposes the major mechanical assemblies.

LOCKED STYLE: pure white background. Hyper-realistic monochrome black and charcoal technical linework with restrained grayscale shading. Black, charcoal, gray and white only.

ABSOLUTELY FORBIDDEN: orange or any other color; colored trim; accent strokes; inset or detail boxes; framed close-ups; component panels; floating parts; leader or connector lines; dots; arrows; labels; captions; surrounding schematics; decorative borders; scenery; people; a second machine; manufacturer text; model text; logos; deer emblems; badges; watermarks; tire or track lettering; panel markings; pseudo-text; invented branding. Keep every visible panel, sidewall and counterweight blank.

Do not add an attachment unless it is explicitly part of the verified machine configuration above."""


def generate(row: dict) -> Image.Image:
    payload = {
        "model": os.environ["AZURE_FOUNDRY_IMAGE_DEPLOYMENT"],
        "prompt": prompt_for(row),
        "size": "1024x1024",
        "quality": "high",
        "n": 1,
    }
    response = requests.post(
        azure_endpoint(os.environ["AZURE_IMAGE_ENDPOINT"], "images/generations"),
        headers=azure_headers(os.environ["AZURE_IMAGE_API_KEY"]),
        json=payload,
        timeout=300,
    )
    response.raise_for_status()
    data = response.json()
    first = (data.get("data") or [{}])[0]
    if first.get("b64_json"):
        raw = base64.b64decode(first["b64_json"])
    elif first.get("url"):
        with urllib.request.urlopen(first["url"], timeout=120) as remote:
            raw = remote.read()
    else:
        raise RuntimeError("Azure image generation returned no image bytes")
    return Image.open(io.BytesIO(raw)).convert("RGBA")


def normalize_monochrome(source: Image.Image) -> Image.Image:
    background = Image.new("RGBA", source.size, (255, 255, 255, 255))
    background.alpha_composite(source)
    gray = background.convert("L")
    # Compression haze in the nominally white background is removed without
    # flattening intentional technical shading inside the machine.
    gray = gray.point(lambda value: 255 if value >= 248 else value)
    return gray.convert("RGB")


def fit_on_white_canvas(source: Image.Image, canvas_size: int = 1024, fill_ratio: float = 0.84) -> Image.Image:
    """Center all visible artwork on a white square with deterministic margins.

    Image generation sometimes returns a good machine only a few pixels from an
    edge.  Reframing is lossless with respect to the generated subject: every
    non-background pixel is retained, uniformly scaled, and centered.  It never
    invents or removes machine geometry, so the semantic vision gate still has
    to approve the result.
    """
    gray = source.convert("L")
    foreground_mask = gray.point(lambda value: 255 if value < 246 else 0)
    bounds = foreground_mask.getbbox()
    if bounds is None:
        return Image.new("RGB", (canvas_size, canvas_size), "white")

    crop = source.crop(bounds)
    target = int(canvas_size * fill_ratio)
    scale = min(target / crop.width, target / crop.height)
    fitted_size = (
        max(1, round(crop.width * scale)),
        max(1, round(crop.height * scale)),
    )
    crop = crop.resize(fitted_size, Image.Resampling.LANCZOS)
    # Resampling can reintroduce near-white compression values at the crop edge.
    crop = normalize_monochrome(crop)
    canvas = Image.new("RGB", (canvas_size, canvas_size), "white")
    position = ((canvas_size - crop.width) // 2, (canvas_size - crop.height) // 2)
    canvas.paste(crop, position)
    return canvas


def pixel_qc(image: Image.Image) -> tuple[bool, dict]:
    width, height = image.size
    if width != height or min(width, height) < 1024:
        return False, {"reason": "NOT_SQUARE_1024", "size": [width, height]}
    pixels = image.load()
    nonneutral = 0
    dark_points: list[tuple[int, int]] = []
    border_total = 0
    border_white = 0
    border_width = max(12, width // 50)
    for y in range(height):
        for x in range(width):
            r, g, b = pixels[x, y]
            if r != g or g != b:
                nonneutral += 1
            if r < 246:
                dark_points.append((x, y))
            if x < border_width or x >= width - border_width or y < border_width or y >= height - border_width:
                border_total += 1
                if r == 255 and g == 255 and b == 255:
                    border_white += 1
    if not dark_points:
        return False, {"reason": "BLANK", "nonneutralPixels": nonneutral}
    xs = [point[0] for point in dark_points]
    ys = [point[1] for point in dark_points]
    bounds = [min(xs), min(ys), max(xs), max(ys)]
    occupancy = len(dark_points) / (width * height)
    margins = [bounds[0], bounds[1], width - 1 - bounds[2], height - 1 - bounds[3]]
    metrics = {
        "size": [width, height],
        "nonneutralPixels": nonneutral,
        "borderPureWhiteRatio": round(border_white / border_total, 6),
        "inkOccupancy": round(occupancy, 6),
        "subjectBounds": bounds,
        "margins": margins,
    }
    passed = (
        nonneutral == 0
        and metrics["borderPureWhiteRatio"] >= 0.985
        and 0.075 <= occupancy <= 0.62
        and min(margins) >= 32
        and max(bounds[2] - bounds[0], bounds[3] - bounds[1]) >= int(width * 0.55)
    )
    if not passed:
        metrics["reason"] = "PIXEL_OR_COMPOSITION_GATE"
    return passed, metrics


def response_text(payload: dict) -> str:
    if isinstance(payload.get("output_text"), str):
        return payload["output_text"]
    for output in payload.get("output") or []:
        for content in output.get("content") or []:
            if isinstance(content.get("text"), str):
                return content["text"]
    return ""


def parse_json(text: str) -> dict:
    text = text.strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start, end = text.find("{"), text.rfind("}")
        if start < 0 or end <= start:
            raise RuntimeError("Azure GPT-5 mini returned no JSON decision")
        return json.loads(text[start : end + 1])


def visual_qc(row: dict, image: Image.Image) -> dict:
    buffer = io.BytesIO()
    image.save(buffer, "PNG", optimize=True)
    encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
    prompt = f"""Strictly inspect this proposed collection illustration for model {row['model']}.
Verified configuration: {row['machineType']}.

Return JSON only with keys: pass (boolean), reason (string), exact_machine_type (boolean), exactly_one_machine (boolean), full_machine_visible (boolean), correct_wheel_track_or_row_geometry (boolean), white_background (boolean), monochrome_only (boolean), no_text_logo_badge_or_pseudotext (boolean), blank_panels_and_sidewalls (boolean), no_boxes_callouts_leaders_arrows_or_floating_parts (boolean), centered_with_even_margins (boolean).

PASS only if every boolean after reason is true. Reject generic or wrong machine families, incorrect wheel/track/row count, implausible geometry, extra implements not in the verified configuration, any branding or pseudo-writing, any crop, any colored mark, and any inset/callout/diagram decoration."""
    properties = {
        "pass": {"type": "boolean"},
        "reason": {"type": "string"},
        "exact_machine_type": {"type": "boolean"},
        "exactly_one_machine": {"type": "boolean"},
        "full_machine_visible": {"type": "boolean"},
        "correct_wheel_track_or_row_geometry": {"type": "boolean"},
        "white_background": {"type": "boolean"},
        "monochrome_only": {"type": "boolean"},
        "no_text_logo_badge_or_pseudotext": {"type": "boolean"},
        "blank_panels_and_sidewalls": {"type": "boolean"},
        "no_boxes_callouts_leaders_arrows_or_floating_parts": {"type": "boolean"},
        "centered_with_even_margins": {"type": "boolean"},
    }
    payload = {
        "model": os.environ.get("AZURE_FOUNDRY_REVIEW_DEPLOYMENT", "gpt-5-mini"),
        "max_output_tokens": 1600,
        "reasoning": {"effort": "low"},
        "text": {
            "format": {
                "type": "json_schema",
                "name": "deere_locked_visual_qc",
                "strict": True,
                "schema": {
                    "type": "object",
                    "properties": properties,
                    "required": list(properties),
                    "additionalProperties": False,
                },
            }
        },
        "input": [{
            "role": "user",
            "content": [
                {"type": "input_text", "text": prompt},
                {"type": "input_image", "image_url": "data:image/png;base64," + encoded, "detail": "high"},
            ],
        }],
    }
    response = requests.post(
        azure_endpoint(os.environ["AZURE_FOUNDRY_ENDPOINT"], "responses"),
        headers=azure_headers(os.environ["AZURE_FOUNDRY_API_KEY"]),
        json=payload,
        timeout=180,
    )
    response.raise_for_status()
    decision = parse_json(response_text(response.json()))
    checks = [
        "exact_machine_type",
        "exactly_one_machine",
        "full_machine_visible",
        "correct_wheel_track_or_row_geometry",
        "white_background",
        "monochrome_only",
        "no_text_logo_badge_or_pseudotext",
        "blank_panels_and_sidewalls",
        "no_boxes_callouts_leaders_arrows_or_floating_parts",
        "centered_with_even_margins",
    ]
    decision["pass"] = decision.get("pass") is True and all(decision.get(key) is True for key in checks)
    decision["model"] = os.environ.get("AZURE_FOUNDRY_REVIEW_DEPLOYMENT", "gpt-5-mini")
    return decision


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--attempts", type=int, default=4)
    args = parser.parse_args()
    spec = json.loads(Path(args.manifest).read_text())
    out = Path(args.output)
    out.mkdir(parents=True, exist_ok=True)
    results = []
    for row in spec["models"]:
        slug = row["handle"].removeprefix("john-deere-").removesuffix("-parts")
        failures = []
        accepted = None
        for attempt in range(1, args.attempts + 1):
            try:
                image = fit_on_white_canvas(normalize_monochrome(generate(row)))
                pixel_pass, pixels = pixel_qc(image)
                diagnostics = out / "diagnostics"
                diagnostics.mkdir(exist_ok=True)
                image.save(diagnostics / f"{slug}-attempt-{attempt}.png", "PNG", optimize=True)
                if not pixel_pass:
                    failures.append({"attempt": attempt, "pixel": pixels})
                    continue
                vision = visual_qc(row, image)
                if not vision.get("pass"):
                    failures.append({"attempt": attempt, "vision": vision})
                    continue
                path = out / f"{slug}.png"
                image.save(path, "PNG", optimize=True)
                digest = hashlib.sha256(path.read_bytes()).hexdigest()
                accepted = {
                    **row,
                    "slug": slug,
                    "status": "PASS",
                    "artifactPath": f"image-studio/deere-model-pilot-v1/results/{slug}.png",
                    "sha256": digest,
                    "qc": {"attempt": attempt, "pixel": pixels, "vision": vision},
                }
                break
            except Exception as exc:
                failures.append({"attempt": attempt, "error": str(exc)[:800]})
                if attempt < args.attempts:
                    time.sleep(min(10, attempt * 2))
        if accepted is None:
            accepted = {
                **row,
                "slug": slug,
                "status": "HOLD",
                "failureReason": "All Azure generation attempts failed locked QC",
                "qc": {"attempts": failures},
            }
        results.append(accepted)
    manifest = {
        "id": "deere-model-pilot-v1",
        "batchId": spec["batchId"],
        "approvalState": "AWAITING_OWNER_APPROVAL",
        "shopifyWritePerformed": False,
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "generator": os.environ["AZURE_FOUNDRY_IMAGE_DEPLOYMENT"],
        "reviewer": os.environ.get("AZURE_FOUNDRY_REVIEW_DEPLOYMENT", "gpt-5-mini"),
        "images": results,
        "skipped": spec.get("skipped", []),
    }
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps({"pass": sum(row["status"] == "PASS" for row in results), "hold": sum(row["status"] == "HOLD" for row in results)}))
    # Always leave the manifest behind so a failed QC attempt is inspectable.
    # The workflow's explicit five-PASS gate decides whether anything is
    # published to the approval endpoint.


if __name__ == "__main__":
    main()
