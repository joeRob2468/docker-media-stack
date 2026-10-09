#!/usr/bin/env python3
"""Shelfmark post-download hook (CUSTOM_SCRIPT, JSON payload on stdin).

Shelfmark passes the Hardcover metadata it matched (title, author, series, position, year).

Ebooks: Shelfmark saves them to a staging folder. Write that metadata into EPUB files,
then move every file into CWA's ingest folder, so CWA imports clean title/author/series.
Other formats are moved unchanged. If editing fails, the file is still moved as-is.

Audiobooks: write metadata.opf into the book folder; Audiobookshelf reads it (incl. series
number, which the folder name doesn't carry). Existing metadata.opf files are left alone.
"""
import json
import os
import re
import sys
import tempfile
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET
from xml.sax.saxutils import escape

INGEST = Path(os.environ.get("CWA_INGEST_DIR", "/data/cwa-ingest"))

OPF_NS = "http://www.idpf.org/2007/opf"
DC_NS = "http://purl.org/dc/elements/1.1/"
CONTAINER_NS = "urn:oasis:names:tc:opendocument:xmlns:container"
for prefix, uri in (("", OPF_NS), ("dc", DC_NS), ("opf", OPF_NS)):
    ET.register_namespace(prefix, uri)
ET.register_namespace("dcterms", "http://purl.org/dc/terms/")
ET.register_namespace("xsi", "http://www.w3.org/2001/XMLSchema-instance")


def log(msg: str) -> None:
    print(f"[postprocess] {msg}", file=sys.stderr)


def split_authors(author: str | None) -> list[str]:
    if not author:
        return []
    return [a.strip() for a in re.split(r"\s*(?:&|;|, (?=[A-Z][^,]* [A-Z]))\s*", author) if a.strip()]


def fmt_index(pos) -> str | None:
    if pos is None:
        return None
    return str(int(pos)) if float(pos).is_integer() else str(pos)


def edit_epub(path: Path, meta: dict) -> None:
    with zipfile.ZipFile(path) as zin:
        container = ET.fromstring(zin.read("META-INF/container.xml"))
        rootfile = container.find(f".//{{{CONTAINER_NS}}}rootfile").get("full-path")
        root = ET.fromstring(zin.read(rootfile))
        md = root.find(f"{{{OPF_NS}}}metadata")
        if md is None:
            raise ValueError("OPF has no metadata element")

        def drop(pred):
            for el in [e for e in list(md) if pred(e)]:
                md.remove(el)

        if meta["title"]:
            # also drop a stale sort title, which calibre would otherwise keep
            drop(lambda e: e.tag == f"{{{DC_NS}}}title" or e.get("name") == "calibre:title_sort")
            md.insert(0, ET.Element(f"{{{DC_NS}}}title"))
            md[0].text = meta["title"]
        if meta["authors"]:
            drop(lambda e: e.tag == f"{{{DC_NS}}}creator")
            for name in reversed(meta["authors"]):
                el = ET.Element(f"{{{DC_NS}}}creator", {f"{{{OPF_NS}}}role": "aut"})
                el.text = name
                md.insert(1, el)
        if meta["series"]:
            # Remove old calibre and EPUB3 series info (incl. refines pointing at collections)
            coll_ids = {e.get("id") for e in md if e.get("property") == "belongs-to-collection" and e.get("id")}
            drop(lambda e: e.get("name") in ("calibre:series", "calibre:series_index")
                 or e.get("property") == "belongs-to-collection"
                 or (e.get("refines") or "").lstrip("#") in coll_ids)
            ET.SubElement(md, f"{{{OPF_NS}}}meta", {"name": "calibre:series", "content": meta["series"]})
            if meta["index"]:
                ET.SubElement(md, f"{{{OPF_NS}}}meta", {"name": "calibre:series_index", "content": meta["index"]})
        new_opf = ET.tostring(root, encoding="utf-8", xml_declaration=True)

        fd, tmp = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
        os.close(fd)
        try:
            with zipfile.ZipFile(tmp, "w") as zout:
                names = zin.namelist()
                # EPUB requires "mimetype" first and uncompressed
                if "mimetype" in names:
                    zout.writestr(zipfile.ZipInfo("mimetype"), zin.read("mimetype"), compress_type=zipfile.ZIP_STORED)
                for item in zin.infolist():
                    if item.filename == "mimetype":
                        continue
                    data = new_opf if item.filename == rootfile else zin.read(item.filename)
                    zout.writestr(item, data, compress_type=zipfile.ZIP_DEFLATED)
            os.replace(tmp, path)
        except BaseException:
            Path(tmp).unlink(missing_ok=True)
            raise


def move_to_ingest(path: Path) -> Path:
    INGEST.mkdir(parents=True, exist_ok=True)
    dest = INGEST / path.name
    n = 1
    while dest.exists():
        dest = INGEST / f"{path.stem} ({n}){path.suffix}"
        n += 1
    os.replace(path, dest)  # same filesystem: atomic, CWA never sees a partial file
    return dest


def write_audiobook_opf(folder: Path, meta: dict) -> None:
    target = folder / "metadata.opf"
    if target.exists():
        log(f"{target} exists, left alone")
        return
    lines = [f"    <dc:title>{escape(meta['title'])}</dc:title>"] if meta["title"] else []
    lines += [f'    <dc:creator opf:role="aut">{escape(a)}</dc:creator>' for a in meta["authors"]]
    if meta["year"]:
        lines.append(f"    <dc:date>{escape(str(meta['year']))}</dc:date>")
    if meta["subtitle"]:
        lines.append(f"    <dc:subtitle>{escape(meta['subtitle'])}</dc:subtitle>")
    if meta["language"]:
        lines.append(f"    <dc:language>{escape(meta['language'])}</dc:language>")
    if meta["series"]:
        lines.append(f'    <meta name="calibre:series" content="{escape(meta["series"], {chr(34): "&quot;"})}"/>')
        if meta["index"]:
            lines.append(f'    <meta name="calibre:series_index" content="{meta["index"]}"/>')
    target.write_text(
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<package xmlns="http://www.idpf.org/2007/opf" version="2.0">\n'
        '  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">\n'
        + "\n".join(lines) + "\n  </metadata>\n</package>\n",
        encoding="utf-8",
    )
    log(f"wrote {target}")


def main() -> int:
    payload = json.load(sys.stdin)
    task = payload.get("task", {})
    paths = [Path(p) for p in payload.get("paths", {}).get("final_paths", [])]
    meta = {
        "title": task.get("title"),
        "authors": split_authors(task.get("author")),
        "series": task.get("series_name"),
        "index": fmt_index(task.get("series_position")),
        "year": task.get("year"),
        "subtitle": task.get("subtitle"),
        "language": task.get("language"),
    }
    log(f"{task.get('content_type')}: {meta['title']!r} by {meta['authors']} series={meta['series']!r} #{meta['index']}")

    if task.get("content_type") == "audiobook":
        if paths:
            folder = Path(os.path.commonpath([str(p.parent) for p in paths]))
            write_audiobook_opf(folder, meta)
        return 0

    for path in paths:
        if not path.is_file():
            continue
        if path.suffix.lower() == ".epub":
            try:
                edit_epub(path, meta)
                log(f"metadata written: {path.name}")
            except Exception as e:  # never block the import over metadata
                log(f"could not edit {path.name} ({e}); importing unchanged")
        dest = move_to_ingest(path)
        log(f"moved to {dest}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
