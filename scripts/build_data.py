#!/usr/bin/env python3
"""Build static GeoJSON for the Hong Kong smart-city map.

Station names and line membership come from the MTR open-data line table.
Racecourse is added from the Next Train API specification because that table
omits it. Coordinates and track geometry come from OpenStreetMap route
relations for the ten heavy-rail lines. Traffic-camera locations come from
the Transport Department snapshot dataset.
"""

from __future__ import annotations

import csv
import io
import json
import sys
import time
import unicodedata
import urllib.request
import xml.etree.ElementTree as ET
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "data"
UA = "hk-smart-city-map/0.1 (classroom map; static data build)"
# Route relations observed on OpenStreetMap on 21 November 2026.
# The public Overpass servers were refusing or timing out, so the build reads
# these relations from the OpenStreetMap API instead.
RELATION_IDS = [
    5317238, 5317239,
    4709540, 4709541,
    4248589, 4248590, 4248591, 4248592, 4250432, 4250433, 4250434, 4250435,
    4264526, 4264527, 6587827, 6587828, 6587829, 6587831, 6587832, 6587833,
    6587845, 6587847, 6587848, 6587849, 6587852, 6587853, 20401317,
    4432665, 4432666,
    272125, 6452935, 6658068, 6658069, 6658070, 6663509, 6663510,
    6827211, 6827212,
    5317704, 5317706, 6723725, 6723726,
    269672, 9736602, 9736610, 9736611, 13352937, 13352938,
    6102298, 6102299, 6582965, 6582966,
    269669, 9736530,
]

# Next Train API specification v1.7 (13 March 2025).
SPEC = {
    "AEL": {"name": "機場快綫", "color": "#00888a", "stations": ["HOK", "KOW", "TSY", "AIR", "AWE"]},
    "TCL": {"name": "東涌綫", "color": "#f7943e", "stations": ["HOK", "KOW", "OLY", "NAC", "LAK", "TSY", "SUN", "TUC"]},
    "TML": {
        "name": "屯馬綫",
        "color": "#923011",
        "stations": [
            "WKS", "MOS", "HEO", "TSH", "SHM", "CIO", "STW", "CKT", "TAW", "HIK",
            "DIH", "KAT", "SUW", "TKW", "HOM", "HUH", "ETS", "AUS", "NAC", "MEF",
            "TWW", "KSR", "YUL", "LOP", "TIS", "SIH", "TUM",
        ],
    },
    "TKL": {"name": "將軍澳綫", "color": "#7d499d", "stations": ["NOP", "QUB", "YAT", "TIK", "TKO", "LHP", "HAH", "POA"]},
    "EAL": {
        "name": "東鐵綫",
        "color": "#53b7e8",
        "stations": ["ADM", "EXC", "HUH", "MKK", "KOT", "TAW", "SHT", "FOT", "RAC", "UNI", "TAP", "TWO", "FAN", "SHS", "LOW", "LMC"],
    },
    "SIL": {"name": "南港島綫", "color": "#b6bd00", "stations": ["ADM", "OCP", "WCH", "LET", "SOH"]},
    "TWL": {
        "name": "荃灣綫",
        "color": "#ed1d24",
        "stations": ["CEN", "ADM", "TST", "JOR", "YMT", "MOK", "PRE", "SSP", "CSW", "LCK", "MEF", "LAK", "KWF", "KWH", "TWH", "TSW"],
    },
    "ISL": {
        "name": "港島綫",
        "color": "#007dc5",
        "stations": ["KET", "HKU", "SYP", "SHW", "CEN", "ADM", "WAC", "CAB", "TIH", "FOH", "NOP", "QUB", "TAK", "SWH", "SKW", "HFC", "CHW"],
    },
    "KTL": {
        "name": "觀塘綫",
        "color": "#00ab4e",
        "stations": ["WHA", "HOM", "YMT", "MOK", "PRE", "SKM", "KOT", "LOF", "WTS", "DIH", "CHH", "KOB", "NTK", "KWT", "LAT", "YAT", "TIK"],
    },
    "DRL": {"name": "迪士尼綫", "color": "#f173ac", "stations": ["SUN", "DIS"]},
}

# The lines-and-stations table has no Racecourse row. The live API does.
RACECOURSE = {"code": "RAC", "zh": "馬場", "en": "Racecourse", "lines": ["EAL"]}

VARIANT = str.maketrans({"茘": "荔", "臺": "台", "裡": "里"})


def norm(value: str) -> str:
    text = unicodedata.normalize("NFKC", value or "")
    text = text.translate(VARIANT)
    return text.replace("站", "").replace(" ", "").replace("－", "").replace("-", "")


def fetch(url: str, data: bytes | None = None, timeout: int = 60) -> tuple[bytes, dict]:
    request = urllib.request.Request(url, data=data, headers={"User-Agent": UA, "Accept": "*/*"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read(), dict(response.headers)


def remember_path(tracks: dict, code: str, coords: list[tuple[float, float]]) -> None:
    rounded = []
    for lon, lat in coords:
        point = (round(lon, 5), round(lat, 5))
        if not rounded or rounded[-1] != point:
            rounded.append(point)
    if len(rounded) < 2:
        return
    forward = tuple(rounded)
    reverse = tuple(reversed(rounded))
    tracks[code][forward if forward <= reverse else reverse] = rounded


def load_mtr() -> dict[str, dict]:
    raw, _headers = fetch("https://opendata.mtr.com.hk/data/mtr_lines_and_stations.csv")
    rows = csv.DictReader(io.StringIO(raw.decode("utf-8-sig")))
    stations: dict[str, dict] = {}
    for row in rows:
        code = (row.get("Station Code") or "").strip()
        line = (row.get("Line Code") or "").strip()
        if not code or not line:
            continue
        if line not in SPEC:
            raise SystemExit(f"Unexpected line code in MTR table: {line}")
        item = stations.setdefault(
            code,
            {
                "code": code,
                "zh": (row.get("Chinese Name") or "").strip(),
                "en": (row.get("English Name") or "").strip(),
                "lines": [],
            },
        )
        if line not in item["lines"]:
            item["lines"].append(line)
    stations[RACECOURSE["code"]] = {
        "code": RACECOURSE["code"],
        "zh": RACECOURSE["zh"],
        "en": RACECOURSE["en"],
        "lines": list(RACECOURSE["lines"]),
    }
    for line, spec in SPEC.items():
        found = sorted(code for code, station in stations.items() if line in station["lines"])
        expected = sorted(spec["stations"])
        if found != expected:
            missing = sorted(set(expected) - set(found))
            extra = sorted(set(found) - set(expected))
            raise SystemExit(f"{line} station list does not match the Next Train specification. missing={missing} extra={extra}")
    return stations


def load_osm(stations: dict[str, dict]) -> dict[str, list[list[list[float]]]]:
    import xml.etree.ElementTree as ET

    grouped = defaultdict(list)
    buckets = {code: {} for code in SPEC}
    for index, relation_id in enumerate(RELATION_IDS, start=1):
        url = f"https://api.openstreetmap.org/api/0.6/relation/{relation_id}/full"
        print(f"osm {index}/{len(RELATION_IDS)} {relation_id}")
        raw, _headers = fetch(url, timeout=90)
        root = ET.fromstring(raw)
        nodes = {}
        for node in root.findall("node"):
            lon = float(node.get("lon"))
            lat = float(node.get("lat"))
            nodes[node.get("id")] = (lon, lat)
            tags = {tag.get("k"): tag.get("v") for tag in node.findall("tag")}
            if tags.get("public_transport") == "stop_position" or tags.get("railway") == "stop":
                name = tags.get("name:zh") or tags.get("name") or ""
                if name:
                    grouped[norm(name)].append((lat, lon))
        ways = {}
        for way in root.findall("way"):
            coords = [nodes[nd.get("ref")] for nd in way.findall("nd") if nd.get("ref") in nodes]
            ways[way.get("id")] = coords
        for relation in root.findall("relation"):
            tags = {tag.get("k"): tag.get("v") for tag in relation.findall("tag")}
            code = tags.get("ref")
            network = tags.get("network") or ""
            if code not in SPEC or ("港鐵" not in network and "MTR" not in network):
                continue
            for member in relation.findall("member"):
                if member.get("type") != "way":
                    continue
                remember_path(buckets, code, ways.get(member.get("ref")) or [])
        time.sleep(0.25)

    missing = []
    for station in stations.values():
        points = grouped.get(norm(station["zh"]), [])
        if not points:
            missing.append(f"{station['code']} {station['zh']}")
            continue
        unique = []
        for lat, lon in points:
            if all(abs(lat - other[0]) > 0.0004 or abs(lon - other[1]) > 0.0004 for other in unique):
                unique.append((lat, lon))
        if len(unique) > 1:
            span = max((((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2) ** 0.5 for a in unique for b in unique))
            if span > 0.01:
                raise SystemExit(f"Station {station['zh']} has coordinates {span:.3f} degrees apart: {unique}")
        lat = sum(point[0] for point in unique) / len(unique)
        lon = sum(point[1] for point in unique) / len(unique)
        if not (22.1 <= lat <= 22.7 and 113.7 <= lon <= 114.5):
            raise SystemExit(f"Station {station['zh']} is outside Hong Kong: {lat}, {lon}")
        station["lat"] = lat
        station["lon"] = lon
    if missing:
        raise SystemExit("No OpenStreetMap coordinate for: " + ", ".join(missing))

    tracks = {}
    for code, paths in buckets.items():
        if not paths:
            raise SystemExit(f"No track geometry for {code}")
        tracks[code] = [list(map(list, path)) for path in paths.values()]
    return tracks


def load_cameras() -> tuple[list[dict], str]:
    raw, headers = fetch("https://static.data.gov.hk/td/traffic-snapshot-images/code/Traffic_Camera_Locations_Tc.csv")
    modified = headers.get("Last-Modified") or headers.get("last-modified") or ""
    text = raw.decode("utf-16").lstrip("\ufeff")
    rows = list(csv.DictReader(io.StringIO(text), delimiter="\t"))
    cameras = []
    for row in rows:
        key = (row.get("key") or "").strip()
        try:
            lat = float(row["latitude"])
            lon = float(row["longitude"])
        except (KeyError, TypeError, ValueError) as error:
            raise SystemExit(f"Camera {key} has no coordinate: {error}") from error
        url = (row.get("url") or "").strip() or f"https://tdcctv.data.one.gov.hk/{key}.JPG"
        if not key:
            continue
        cameras.append(
            {
                "key": key,
                "region": (row.get("region") or "").strip(),
                "district": (row.get("district") or "").strip(),
                "description": (row.get("description") or "").strip(),
                "lat": lat,
                "lon": lon,
                "url": url,
            }
        )
    if len(cameras) < 900:
        raise SystemExit(f"Expected about 1,013 cameras, found {len(cameras)}")
    cameras.sort(key=lambda item: item["key"])
    return cameras, modified


def write_json(path: Path, payload: dict) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {path.relative_to(ROOT)} ({path.stat().st_size} bytes)")


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    stations = load_mtr()
    print(f"official stations {len(stations)}")
    tracks = load_osm(stations)
    cameras, camera_modified = load_cameras()

    station_features = []
    for station in sorted(stations.values(), key=lambda item: item["code"]):
        station_features.append(
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [round(station["lon"], 6), round(station["lat"], 6)]},
                "properties": {
                    "code": station["code"],
                    "name_zh": station["zh"],
                    "name_en": station["en"],
                    "lines": [line for line in SPEC if line in station["lines"]],
                },
            }
        )
    line_features = []
    for code, spec in SPEC.items():
        line_features.append(
            {
                "type": "Feature",
                "geometry": {"type": "MultiLineString", "coordinates": tracks[code]},
                "properties": {"code": code, "name_zh": spec["name"], "color": spec["color"]},
            }
        )
    camera_features = [
        {
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [round(item["lon"], 6), round(item["lat"], 6)]},
            "properties": {
                "key": item["key"],
                "region": item["region"],
                "district": item["district"],
                "description": item["description"],
                "url": item["url"],
            },
        }
        for item in cameras
    ]
    write_json(OUT / "stations.geojson", {"type": "FeatureCollection", "features": station_features})
    write_json(OUT / "lines.geojson", {"type": "FeatureCollection", "features": line_features})
    write_json(OUT / "cameras.geojson", {"type": "FeatureCollection", "features": camera_features})
    write_json(
        OUT / "meta.json",
        {
            "stationCount": len(station_features),
            "cameraCount": len(camera_features),
            "cameraListModified": camera_modified,
            "lines": {code: {"name": spec["name"], "color": spec["color"], "segments": len(tracks[code])} for code, spec in SPEC.items()},
        },
    )
    print(f"cameras {len(camera_features)} modified {camera_modified}")


if __name__ == "__main__":
    main()
