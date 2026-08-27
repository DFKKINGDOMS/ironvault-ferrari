#!/usr/bin/env python3
"""Build PartQuill's compact, user-facing GM catalog lookup dataset.

The source SQLite database remains the evidence/QA workspace.  This exporter
flattens only the searchable identity, application and diagram relationships
needed by the live seller experience into one JSON object per part number.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import sqlite3
from collections import defaultdict
from pathlib import Path


def json_value(value: str | None):
    if not value:
        return None
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return value


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--smoke-output", type=Path)
    parser.add_argument("--smoke-part", default="5459066")
    args = parser.parse_args()

    db = sqlite3.connect(args.source)
    db.row_factory = sqlite3.Row

    profiles = {
        row["global_catalog_key"]: dict(row)
        for row in db.execute("SELECT * FROM catalog_profiles")
    }

    models_by_claim: dict[int, list[dict]] = defaultdict(list)
    for row in db.execute(
        """
        SELECT amc.application_claim_id, amc.model_name,
               amc.derivation_method, amc.relation_confidence,
               amc.verification_state, legend.year, legend.division,
               legend.series_code, legend.source_page_id
        FROM application_model_candidates amc
        JOIN catalog_model_legend_entries legend
          ON legend.model_legend_id = amc.model_legend_id
        ORDER BY amc.application_claim_id, legend.year, amc.model_name
        """
    ):
        models_by_claim[row["application_claim_id"]].append(
            {
                "year": row["year"],
                "division": row["division"],
                "modelName": row["model_name"],
                "seriesCode": row["series_code"],
                "derivationMethod": row["derivation_method"],
                "confidence": row["relation_confidence"],
                "verificationState": row["verification_state"],
                "sourcePageId": row["source_page_id"],
            }
        )

    source_by_correction: dict[int, dict] = {}
    for row in db.execute(
        """
        SELECT correction_id, catalog_title, source_url, evidence_context,
               layout_line_text, layout_cross_reference
        FROM corrected_occurrences
        """
    ):
        source_by_correction[row["correction_id"]] = dict(row)

    applications_by_part: dict[str, list[dict]] = defaultdict(list)
    for row in db.execute(
        "SELECT * FROM part_application_claims ORDER BY corrected_part_number, application_claim_id"
    ):
        source = source_by_correction.get(row["correction_id"], {})
        profile = profiles.get(row["global_catalog_key"], {})
        applications_by_part[row["corrected_part_number"]].append(
            {
                "claimId": row["application_claim_id"],
                "manufacturer": row["manufacturer"],
                "division": row["division"],
                "catalogTitle": profile.get("catalog_title") or source.get("catalog_title"),
                "catalogGroup": row["catalog_group"],
                "partName": row["part_name"],
                "description": row["description_raw"],
                "groupHeading": row["group_heading_raw"],
                "componentFamily": row["component_family"],
                "supplier": row["supplier"],
                "applicationText": row["raw_application_text"],
                "yearStart": row["year_start"],
                "yearEnd": row["year_end"],
                "modelScope": row["model_scope_raw"],
                "equipmentQualifier": row["equipment_qualifier"],
                "exclusion": row["exclusion_text"],
                "position": row["position_text"],
                "quantity": row["quantity_raw"],
                "sourcePageId": row["source_page_id"],
                "sourceUrl": source.get("source_url"),
                "imageRef": row["image_ref"],
                "imageBlobKey": row["image_blob_key"],
                "evidenceBox": json_value(row["evidence_bbox_json"]),
                "evidenceContext": source.get("evidence_context"),
                "layoutLine": source.get("layout_line_text"),
                "crossReference": source.get("layout_cross_reference"),
                "relationMethod": row["relation_method"],
                "confidence": row["relation_confidence"],
                "verificationState": row["verification_state"],
                "modelExpansionState": row["model_expansion_state"],
                "models": models_by_claim.get(row["application_claim_id"], []),
            }
        )

    diagrams_by_part: dict[str, list[dict]] = defaultdict(list)
    for row in db.execute(
        """
        SELECT edge.corrected_part_number, edge.diagram_page_id,
               edge.catalog_group, edge.callout_label, edge.relationship_state,
               edge.link_method, edge.link_confidence, edge.supplier_match,
               edge.year_relationship, edge.exact_part_depiction,
               edge.evidence_bbox_json, edge.is_primary, edge.rationale,
               page.diagram_title, page.illustration_number,
               page.diagram_year_start, page.diagram_year_end,
               page.source_url, page.image_ref, page.image_blob_key,
               page.display_rotation_degrees, page.verification_state
        FROM visual_evidence_edges edge
        JOIN diagram_group_callouts callout
          ON callout.diagram_callout_id = edge.diagram_callout_id
        JOIN diagram_pages page ON page.diagram_id = callout.diagram_id
        ORDER BY edge.corrected_part_number, edge.is_primary DESC,
                 edge.link_confidence DESC, edge.diagram_page_id
        """
    ):
        diagrams_by_part[row["corrected_part_number"]].append(
            {
                "pageId": row["diagram_page_id"],
                "catalogGroup": row["catalog_group"],
                "calloutLabel": row["callout_label"],
                "title": row["diagram_title"],
                "illustrationNumber": row["illustration_number"],
                "yearStart": row["diagram_year_start"],
                "yearEnd": row["diagram_year_end"],
                "sourceUrl": row["source_url"],
                "imageRef": row["image_ref"],
                "imageBlobKey": row["image_blob_key"],
                "displayRotationDegrees": row["display_rotation_degrees"],
                "evidenceBox": json_value(row["evidence_bbox_json"]),
                "relationshipState": row["relationship_state"],
                "linkMethod": row["link_method"],
                "confidence": row["link_confidence"],
                "supplierMatch": row["supplier_match"],
                "yearRelationship": row["year_relationship"],
                "exactPartDepiction": bool(row["exact_part_depiction"]),
                "isPrimary": bool(row["is_primary"]),
                "rationale": row["rationale"],
                "verificationState": row["verification_state"],
            }
        )

    args.output.parent.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256()
    row_count = 0
    smoke_record = None
    with gzip.open(args.output, "wb", compresslevel=9) as output:
        for row in db.execute(
            "SELECT * FROM corrected_rollups ORDER BY corrected_part_number"
        ):
            part_number = row["corrected_part_number"]
            applications = applications_by_part.get(part_number, [])
            divisions = sorted({a["division"] for a in applications if a["division"]})
            descriptions = [a["description"] for a in applications if a["description"]]
            families = [a["componentFamily"] for a in applications if a["componentFamily"]]
            record = {
                "partNumber": part_number,
                "manufacturer": "General Motors",
                "divisions": divisions,
                "productType": families[0] if families else (descriptions[0] if descriptions else row["representative_description"]),
                "description": descriptions[0] if descriptions else row["representative_description"],
                "catalogGroup": applications[0]["catalogGroup"] if applications else row["representative_catalog_group"],
                "verificationState": row["verification_state"],
                "rollup": {
                    "occurrenceCount": row["occurrence_count"],
                    "pageCount": row["page_count"],
                    "catalogStatedOccurrences": row["catalog_stated_occurrences"],
                    "firstPageId": row["first_page_id"],
                    "lastPageId": row["last_page_id"],
                    "representativePageId": row["representative_page_id"],
                    "representativeImageRef": row["representative_image_ref"],
                    "bestLayoutConfidence": row["best_layout_confidence"],
                },
                "applications": applications,
                "diagrams": diagrams_by_part.get(part_number, []),
            }
            encoded = json.dumps(record, ensure_ascii=False, separators=(",", ":")).encode("utf-8") + b"\n"
            output.write(encoded)
            digest.update(encoded)
            row_count += 1
            if part_number == args.smoke_part:
                smoke_record = record

    if args.smoke_output and smoke_record:
        args.smoke_output.parent.mkdir(parents=True, exist_ok=True)
        args.smoke_output.write_text(
            json.dumps(smoke_record, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )

    print(json.dumps({"rows": row_count, "sha256": digest.hexdigest(), "output": str(args.output)}))


if __name__ == "__main__":
    main()
