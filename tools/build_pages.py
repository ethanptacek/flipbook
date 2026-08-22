#!/usr/bin/env python3
"""
Render the source catalog PDFs into ordered, web-optimised flipbook pages.

Source PDFs live in ``source-pdfs/`` and are ordered by the leading number in
their filename.  Multi-page PDFs contribute their pages in document order, so
the final page numbering is a straight 1..N run across the whole catalog.

Outputs
    docs/pages/page-NN.webp   full-size page  (WIDTH px wide)
    docs/pages/page-NN.jpg    fallback for browsers without WebP
    docs/pages/thumb-NN.webp  thumbnail for the page navigator
    docs/pages/catalog.pdf    all pages merged, for the download button
    docs/pages/manifest.json  page list + dimensions + blur placeholders
"""

import base64
import io
import json
import os
import re
import shutil
import sys

import pymupdf
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "source-pdfs")
OUT = os.path.join(ROOT, "docs", "pages")

WIDTH = 1400        # full page render width in px
THUMB_WIDTH = 200   # navigator thumbnail width
BLUR_WIDTH = 12     # inline placeholder width
WEBP_QUALITY = 82
JPEG_QUALITY = 84


# Page metadata, in final flipbook order.  The source PDFs are flattened
# artwork (no extractable text), so titles and sections are transcribed from
# the pages themselves rather than derived from filenames.
PAGE_META = [
    ("Front Cover",                 "Cover"),
    ("About Warning Lites",         "Introduction"),
    ("Product Categories",          "Introduction"),
    ("Safety Apparel",              "Safety Apparel"),
    ("Hi-Vis Vests",                "Safety Apparel"),
    ("T-Shirts & Women's Vests",    "Safety Apparel"),
    ("Hoodies & Sweatshirts",       "Safety Apparel"),
    ("Jackets & Bombers",           "Safety Apparel"),
    ("Parkas & Softshells",         "Safety Apparel"),
    ("Rainwear & Insulated Bibs",   "Safety Apparel"),
    ("Rain Jackets & Pants",        "Safety Apparel"),
    ("Traffic Cones",               "Traffic Cones"),
    ("Cone Specifications",         "Traffic Cones"),
    ("Cone Sizes & Inventory",      "Traffic Cones"),
    ("Cone Signs",                  "Traffic Cones"),
    ("Delineators",                 "Delineators"),
    ("Channelizers & Bases",        "Delineators"),
    ("Roll-Up Signs",               "Roll-Up Signs"),
    ("Roll-Up Signs & Accessories", "Roll-Up Signs"),
    ("Sign Stands & Accessories",   "Roll-Up Signs"),
    ("Back Cover",                  "Back Cover"),
]

def leading_number(path):
    m = re.match(r"\s*(\d+)", os.path.basename(path))
    return int(m.group(1)) if m else 10_000


def source_pdfs():
    pdfs = [
        os.path.join(SRC, f)
        for f in os.listdir(SRC)
        if f.lower().endswith(".pdf")
    ]
    return sorted(pdfs, key=lambda p: (leading_number(p), os.path.basename(p)))


def blur_placeholder(img):
    """Tiny inline data URI so a page has something to show while it loads."""
    small = img.copy()
    small.thumbnail((BLUR_WIDTH, BLUR_WIDTH * 4), Image.LANCZOS)
    buf = io.BytesIO()
    small.convert("RGB").save(buf, "JPEG", quality=40)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode("ascii")


def main():
    if os.path.isdir(OUT):
        shutil.rmtree(OUT)
    os.makedirs(OUT, exist_ok=True)

    sources = source_pdfs()
    total = 0
    for pdf_path in sources:
        doc = pymupdf.open(pdf_path)
        total += doc.page_count
        doc.close()
    if total != len(PAGE_META):
        raise SystemExit(
            f"PAGE_META describes {len(PAGE_META)} pages but the PDFs in "
            f"{SRC} contain {total}. Update PAGE_META to match."
        )

    merged = pymupdf.open()
    pages = []
    index = 0

    for pdf_path in sources:
        doc = pymupdf.open(pdf_path)
        merged.insert_pdf(doc)

        for page_no in range(doc.page_count):
            index += 1
            page = doc[page_no]
            zoom = WIDTH / page.rect.width
            pix = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), alpha=False)
            img = Image.open(io.BytesIO(pix.tobytes("png"))).convert("RGB")

            stem = f"page-{index:02d}"
            img.save(os.path.join(OUT, f"{stem}.webp"), "WEBP", quality=WEBP_QUALITY, method=6)
            img.save(os.path.join(OUT, f"{stem}.jpg"), "JPEG", quality=JPEG_QUALITY,
                     optimize=True, progressive=True)

            thumb = img.copy()
            thumb.thumbnail((THUMB_WIDTH, THUMB_WIDTH * 4), Image.LANCZOS)
            thumb.save(os.path.join(OUT, f"thumb-{index:02d}.webp"), "WEBP", quality=76, method=6)

            title, section = PAGE_META[index - 1]
            pages.append({
                "n": index,
                "title": title,
                "section": section,
                "src": f"pages/{stem}.webp",
                "fallback": f"pages/{stem}.jpg",
                "thumb": f"pages/thumb-{index:02d}.webp",
                "blur": blur_placeholder(img),
            })
            print(f"  page {index:>2}  {section:<16} {title}")

        doc.close()

    pdf_path = os.path.join(OUT, "catalog.pdf")
    merged.save(pdf_path, garbage=4, deflate=True)
    merged.close()
    pdf_mb = os.path.getsize(pdf_path) / (1024 * 1024)

    manifest = {
        "title": "2026 Product Catalog",
        "brand": "Warning Lites",
        "tagline": "Performance with Pride",
        "aspect": round(792 / 612, 6),   # height / width of a US-Letter page
        "pdf": "pages/catalog.pdf",
        "pdfSize": ("%.0f MB" % pdf_mb) if pdf_mb >= 10 else ("%.1f MB" % pdf_mb),
        "pages": pages,
    }
    with open(os.path.join(OUT, "manifest.json"), "w") as fh:
        json.dump(manifest, fh, indent=2)

    print(f"\n{len(pages)} pages -> {OUT}  (catalog.pdf {pdf_mb:.1f} MB)")


if __name__ == "__main__":
    sys.exit(main())
