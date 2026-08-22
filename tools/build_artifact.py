#!/usr/bin/env python3
"""
Bundle the flipbook into one self-contained HTML file for a Claude Artifact.

Artifacts are published as a single page under a strict CSP: no stylesheets,
scripts, fonts or images may be fetched from anywhere, and the sandbox blocks
downloads the page starts itself.  So this build inlines the stylesheet, the
script, the fonts and all 21 pages as data URIs, embeds the manifest instead of
fetching it, and drops the two controls that cannot work in that sandbox (the
PDF download and the copy-link button).

The output has no <!doctype>/<html>/<head>/<body> — the artifact host supplies
those and inlines this file into the body.

    python3 tools/build_artifact.py [-o artifact/flipbook-artifact.html]
"""

import argparse
import base64
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOCS = os.path.join(ROOT, "docs")

TITLE = "Warning Lites Catalog"


def data_uri(path, mime):
    with open(path, "rb") as fh:
        return "data:%s;base64,%s" % (mime, base64.b64encode(fh.read()).decode("ascii"))


def inline_fonts(css):
    """Embed the woff2 files, dropping latin-ext: it is never used by this UI
    and unicode-range cannot save the bytes once the font is inlined."""
    blocks = re.findall(r"@font-face\s*\{.*?\}", css, re.S)
    kept = []
    for block in blocks:
        m = re.search(r"url\('fonts/([^']+)'\)", block)
        if not m or "latin-ext" in m.group(1):
            continue
        uri = data_uri(os.path.join(DOCS, "assets", "fonts", m.group(1)), "font/woff2")
        kept.append(re.sub(r"url\('fonts/[^']+'\)", "url(%s)" % uri, block))
    return "\n".join(kept)


def body_markup():
    """Everything between <body> and the external <script>, with the controls
    that the artifact sandbox cannot honour removed."""
    html = open(os.path.join(DOCS, "flipbook.html")).read()
    body = html[html.index("<body>") + len("<body>"):html.index('<script src="assets/flipbook.js">')]

    # a download the page starts itself is inert inside the artifact sandbox
    body = re.sub(r'\s*<a class="fb-btn" data-act="download".*?</a>\n', "\n", body, flags=re.S)
    # location.href inside the sandboxed frame is not the address the reader sees
    body = re.sub(r'\s*<button class="fb-btn" type="button" data-act="share".*?</button>\n',
                  "\n", body, flags=re.S)
    return body.strip()


def manifest_for_artifact():
    src = json.load(open(os.path.join(DOCS, "pages", "manifest.json")))
    out = {"title": src["title"], "brand": src["brand"], "aspect": src["aspect"], "pages": []}
    for page in src["pages"]:
        out["pages"].append({
            "n": page["n"],
            "title": page["title"],
            "section": page["section"],
            # no fallback and no blur placeholder: nothing is fetched, so there
            # is no load to cover and no browser here without WebP
            "src": data_uri(os.path.join(DOCS, page["src"]), "image/webp"),
            "thumb": data_uri(os.path.join(DOCS, page["thumb"]), "image/webp"),
        })
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("-o", "--out", default=os.path.join(ROOT, "artifact", "flipbook-artifact.html"))
    args = ap.parse_args()

    fonts = inline_fonts(open(os.path.join(DOCS, "assets", "fonts.css")).read())
    css = open(os.path.join(DOCS, "assets", "flipbook.css")).read()
    js = open(os.path.join(DOCS, "assets", "flipbook.js")).read()
    manifest = manifest_for_artifact()

    page = """<title>%(title)s</title>

<style>
%(fonts)s

/* The artifact fills its frame; --fb-bg is painted explicitly so the page never
   borrows the host's ground. */
html, body {
  height: 100%%;
  margin: 0;
  background: var(--fb-bg);
  overscroll-behavior: none;
}

%(css)s
</style>

%(body)s

<script>
/* theme "auto" leaves the document unstamped, so the reader follows whatever
   theme the person viewing this artifact is in */
window.FLIPBOOK_CONFIG = { theme: "auto", page: 1 };
window.FLIPBOOK_MANIFEST = %(manifest)s;
</script>
<script>
%(js)s
</script>
""" % {
        "title": TITLE,
        "fonts": fonts,
        "css": css,
        "body": body_markup(),
        "manifest": json.dumps(manifest, separators=(",", ":")),
        "js": js,
    }

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w") as fh:
        fh.write(page)

    mb = len(page.encode("utf-8")) / (1024 * 1024)
    print("%s\n  %d pages inlined, %.2f MB of a 16 MB budget" % (args.out, len(manifest["pages"]), mb))
    if mb > 15:
        print("  WARNING: close to the artifact size limit", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
