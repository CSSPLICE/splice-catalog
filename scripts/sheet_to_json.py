#!/usr/bin/env python3
"""
Convert the catalog Google Sheet to the JSON format used in data/datasets.json.

You can point the script at a Google Sheet CSV export URL, a sheet ID + gid,
or a local CSV/XLSX export (helpful for testing). Only the standard library is
used so it can run from cron without extra dependencies.
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import re
import sys
import urllib.request
import zipfile
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta
from typing import Dict, Iterable, List, Optional, Sequence


FIELD_ORDER = [
    "catalog_type",
    "publisher",
    "resource_url",
    "resource_url_type",
    "bibtex_source",
    "title",
    "creator",
    "given_name",
    "family_name",
    "name_identifier",
    "affiliation",
    "availability",
    "format",
    "programming_language",
    "data_collection_start_date",
    "data_collection_end_date",
    "publication_year",
    "number_of_semesters",
    "data_protection",
    "data_type",
    "measurement_type",
    "data_processing",
    "population",
    "units_number",
    "task_number",
    "sample_size",
    "sample_demographics",
    "country",
    "educational_institution",
    "data_standard",
    "learning_environment",
    "aggregation",
    "aggregation_level",
    "related_publication_url",
    "related_publication",
    "rights",
    "description",
    "research_question",
    "future_work",
    "fairness_score",
]

# Map normalized column headers to JSON fields
HEADER_MAP = {
    "publisher": "publisher",
    "url to resource": "resource_url",
    "resource url type": "resource_url_type",
    "bibtex source": "bibtex_source",
    "title": "title",
    "creator": "creator",
    "given name": "given_name",
    "family name": "family_name",
    "name identifier": "name_identifier",
    "affiliation": "affiliation",
    "availability": "availability",
    "format": "format",
    "programming language": "programming_language",
    "data collection start date": "data_collection_start_date",
    "data collection end date": "data_collection_end_date",
    "publication year": "publication_year",
    "number of semesters": "number_of_semesters",
    "data protection": "data_protection",
    "data type": "data_type",
    "measurement type": "measurement_type",
    "data processing": "data_processing",
    "population": "population",
    "units number (# rows)": "units_number",
    "units number (#rows)": "units_number",
    "task number": "task_number",
    "sample size": "sample_size",
    "sample demographics": "sample_demographics",
    "country": "country",
    "educational institution": "educational_institution",
    "data standard": "data_standard",
    "learning environment": "learning_environment",
    "aggregation": "aggregation",
    "aggregation level": "aggregation_level",
    "url to related publication": "related_publication_url",
    "related publication": "related_publication",
    "rights": "rights",
    "description": "description",
    "research question": "research_question",
    "future work": "future_work",
    "fairness score": "fairness_score",
}

NULL_MARKERS = {"", "n/a", "na", "n.a", "null"}
DATE_FIELDS = {"data_collection_start_date", "data_collection_end_date"}
NUMERIC_FIELDS = {"publication_year", "number_of_semesters", "task_number", "sample_size"}
NUMERIC_PATTERN = re.compile(r"^-?\d+(?:\.\d+)?$")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Convert the catalog sheet to data/datasets.json format."
    )
    parser.add_argument(
        "--sheet-url",
        help="Full CSV export URL for the Google Sheet "
        "(e.g., https://docs.google.com/spreadsheets/d/<id>/export?format=csv&gid=<gid>).",
    )
    parser.add_argument("--sheet-id", help="Google Sheet ID (used with --gid to build a CSV export URL).")
    parser.add_argument(
        "--gid",
        default="0",
        help="Worksheet gid within the Google Sheet (default: 0). Ignored when --sheet-url is provided.",
    )
    parser.add_argument(
        "--input-file",
        help="Local CSV or XLSX export of the sheet (useful for testing without network access).",
    )
    parser.add_argument(
        "--output",
        default="data/datasets.json",
        help="Path to write the resulting JSON (default: data/datasets.json).",
    )
    parser.add_argument(
        "--sheet-index",
        type=int,
        default=0,
        help="0-based sheet index to read from an XLSX file (default: 0).",
    )
    return parser.parse_args()


def normalize_header(text: str) -> str:
    """Lowercase, collapse whitespace, and remove leading punctuation for comparison."""
    if text is None:
        return ""
    cleaned = text.replace("\xa0", " ").strip()
    cleaned = re.sub(r"\s+", " ", cleaned)
    cleaned = cleaned.lstrip(".").lower()
    return cleaned


def fetch_csv(url: str) -> List[List[str]]:
    with urllib.request.urlopen(url) as resp:
        content = resp.read().decode("utf-8-sig")
    return list(csv.reader(io.StringIO(content)))


def load_csv(path: str) -> List[List[str]]:
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.reader(f))


def list_sheet_paths(zf: zipfile.ZipFile) -> List[str]:
    main_ns = {"main": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    pkg_ns = {"pkg": "http://schemas.openxmlformats.org/package/2006/relationships"}
    workbook = ET.fromstring(zf.read("xl/workbook.xml"))
    rels = ET.fromstring(zf.read("xl/_rels/workbook.xml.rels"))
    rel_map = {rel.attrib["Id"]: rel.attrib["Target"] for rel in rels.findall("pkg:Relationship", pkg_ns)}
    paths = []
    for sheet in workbook.findall("main:sheets/main:sheet", main_ns):
        r_id = sheet.attrib.get("{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id")
        target = rel_map.get(r_id)
        if target:
            paths.append("xl/" + target)
    return paths


def read_xlsx(path: str, sheet_index: int = 0) -> List[List[str]]:
    """Minimal XLSX reader that returns rows of cell text."""
    with zipfile.ZipFile(path) as zf:
        shared_strings: List[str] = []
        if "xl/sharedStrings.xml" in zf.namelist():
            shared_root = ET.fromstring(zf.read("xl/sharedStrings.xml"))
            shared_strings = [
                "".join(t.text or "" for t in si.findall(".//{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t"))
                for si in shared_root.findall("{http://schemas.openxmlformats.org/spreadsheetml/2006/main}si")
            ]

        sheet_paths = list_sheet_paths(zf)
        if sheet_index >= len(sheet_paths):
            raise IndexError(f"Sheet index {sheet_index} out of range for workbook with {len(sheet_paths)} sheets.")

        sheet_root = ET.fromstring(zf.read(sheet_paths[sheet_index]))
        ns = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"

        def col_to_index(col: str) -> int:
            idx = 0
            for ch in col:
                idx = idx * 26 + (ord(ch.upper()) - ord("A") + 1)
            return idx - 1  # zero-based

        row_dicts: List[Dict[int, str]] = []
        max_col = -1
        for row in sheet_root.findall(f"{ns}sheetData/{ns}row"):
            values: Dict[int, str] = {}
            for cell in row.findall(f"{ns}c"):
                ref = cell.attrib.get("r", "")
                col_letters = "".join(ch for ch in ref if ch.isalpha())
                idx = col_to_index(col_letters) if col_letters else 0
                raw_value = ""
                if cell.attrib.get("t") == "s":
                    v = cell.find(f"{ns}v")
                    raw_value = shared_strings[int(v.text)] if v is not None and v.text is not None else ""
                elif cell.attrib.get("t") == "inlineStr":
                    inline = cell.find(f"{ns}is/{ns}t")
                    raw_value = inline.text if inline is not None and inline.text else ""
                else:
                    v = cell.find(f"{ns}v")
                    raw_value = v.text if v is not None and v.text is not None else ""

                values[idx] = raw_value
                max_col = max(max_col, idx)
            if values:
                row_dicts.append(values)

        rows: List[List[str]] = []
        for row_map in row_dicts:
            row_values = ["" for _ in range(max_col + 1)]
            for idx, val in row_map.items():
                row_values[idx] = val
            rows.append(row_values)
        return rows


def maybe_number(value: str) -> Optional[float]:
    if NUMERIC_PATTERN.match(value):
        try:
            num = float(value)
        except ValueError:
            return None
        return num
    return None


def excel_serial_to_year(num: float) -> int:
    base = datetime(1899, 12, 30)
    return (base + timedelta(days=num)).year


def clean_cell(value: str, field: str) -> Optional[object]:
    text = (value or "").strip()
    if text.lower() in NULL_MARKERS:
        return None

    num = maybe_number(text)
    if field in DATE_FIELDS and num is not None:
        if num > 10000:  # Excel serial date
            return excel_serial_to_year(num)
        if num.is_integer():
            return int(num)
        return num

    if field in NUMERIC_FIELDS and num is not None:
        if num.is_integer():
            return int(num)
        return num

    # For other fields, keep numeric-looking "0"/"1" as numbers to match existing JSON
    if num is not None and num.is_integer():
        return int(num)
    if num is not None:
        return num

    return text or None


def find_header_row(rows: Sequence[Sequence[str]]) -> int:
    for idx, row in enumerate(rows):
        normalized = [normalize_header(cell) for cell in row]
        if "id" in normalized and "publisher" in normalized:
            return idx
    raise ValueError("Could not find header row (expected columns like 'ID' and 'Publisher').")


def rows_to_records(rows: Sequence[Sequence[str]]) -> List[Dict[str, object]]:
    header_idx = find_header_row(rows)
    header_row = rows[header_idx]
    col_to_field: Dict[int, str] = {}
    for idx, header in enumerate(header_row):
        norm = normalize_header(header)
        if norm in HEADER_MAP:
            col_to_field[idx] = HEADER_MAP[norm]

    records: List[Dict[str, object]] = []
    for row in rows[header_idx + 1 :]:
        row_is_blank = all((cell or "").strip() == "" for cell in row)
        if row_is_blank:
            continue

        record = {field: None for field in FIELD_ORDER}
        record["catalog_type"] = "DatasetCatalog"

        for col_idx, field in col_to_field.items():
            cell_value = row[col_idx] if col_idx < len(row) else ""
            record[field] = clean_cell(cell_value, field)

        if all(record.get(field) in (None, "") for field in FIELD_ORDER if field != "catalog_type"):
            continue
        records.append(record)
    return records


def load_rows(args: argparse.Namespace) -> List[List[str]]:
    if args.sheet_url:
        return fetch_csv(args.sheet_url)
    if args.sheet_id:
        url = f"https://docs.google.com/spreadsheets/d/{args.sheet_id}/export?format=csv&gid={args.gid}"
        return fetch_csv(url)
    if args.input_file:
        if args.input_file.lower().endswith(".xlsx"):
            return read_xlsx(args.input_file, sheet_index=args.sheet_index)
        return load_csv(args.input_file)
    raise ValueError("Provide --sheet-url, --sheet-id, or --input-file.")


def main() -> None:
    args = parse_args()
    rows = load_rows(args)
    records = rows_to_records(rows)

    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(records, f, indent=2, ensure_ascii=False)
        f.write("\n")

    print(f"Wrote {len(records)} records to {args.output}")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"Error: {exc}", file=sys.stderr)
        sys.exit(1)
