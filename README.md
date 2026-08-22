# Warning Lites — 2026 Product Catalog flipbook

The Warning Lites 2026 product catalog as an embeddable page-turn flipbook:
21 numbered pages, a two-page spread with a real 3D page turn, back/forward
arrows, drag-to-turn, contents, zoom, and a PDF download.

Everything is static — HTML, CSS and images. No framework, no build step, no
third-party requests at runtime (the fonts are bundled).

```
docs/                      ← publish this folder
├── index.html             landing page + embed instructions (live demo)
├── flipbook.html          the reader itself — this is what gets embedded
├── embed.js               drop-in loader that mounts a responsive iframe
├── assets/
│   ├── flipbook.css/.js   the reader
│   ├── site.css/.js       the landing page
│   └── fonts/             Barlow + Barlow Condensed (OFL), self-hosted
└── pages/
    ├── page-01…21.webp    full-size pages (1400px wide)
    ├── page-01…21.jpg     fallback for browsers without WebP
    ├── thumb-01…21.webp   contents thumbnails
    ├── catalog.pdf        all 21 pages, for the download button
    └── manifest.json      page order, titles, sections, blur placeholders

source-pdfs/               the 14 source PDFs the pages are rendered from
tools/build_pages.py       re-renders docs/pages/ from source-pdfs/
```

## Embedding it

Host the `docs/` folder anywhere that serves static files, then paste one of
these into the page where the book should appear.

**Script embed** (recommended — resizes itself, switches between spread and
single-page as the space allows):

```html
<div data-warning-lites-flipbook></div>
<script src="https://YOUR-HOST/embed.js" defer></script>
```

**Plain iframe** (for page builders that strip `<script>` tags):

```html
<iframe
  src="https://YOUR-HOST/flipbook.html"
  title="Warning Lites 2026 Product Catalog"
  width="100%" height="820"
  style="border:0;border-radius:14px"
  loading="lazy" allow="fullscreen" allowfullscreen></iframe>
```

The landing page at `index.html` shows both snippets with the real URL of
wherever it is hosted already filled in, plus a copy button.

### Options

Set as `data-` attributes on the container, or as query parameters on the
iframe URL (`flipbook.html?page=13&theme=light`).

| Option | Values | Default | Effect |
| --- | --- | --- | --- |
| `page` | 1–21 | `1` | Page the book opens on |
| `theme` | `dark`, `light` | `dark` | Colour of the chrome around the pages |
| `mode` | `auto`, `spread`, `single` | `auto` | Two-page spread, one page, or by width |
| `height` | pixels | — | Fixed height, disables auto-sizing *(script embed only)* |
| `min-height` | pixels | `420` | Auto-size floor *(script embed only)* |
| `max-height` | pixels | `900` | Auto-size ceiling *(script embed only)* |
| `radius` | pixels | `14` | Corner radius of the embed *(script embed only)* |

### Controlling it from the host page

```js
WarningLitesFlipbook.goto(13);
WarningLitesFlipbook.next();
WarningLitesFlipbook.prev();
WarningLitesFlipbook.onPage(function (page, total) { … });
```

## Reading it

| Input | Does |
| --- | --- |
| Arrows either side of the book, or `←` `→` | Turn one page |
| Drag a page sideways (mouse or touch) | Turn it by hand, release to finish or snap back |
| `Home` / `End` | Front cover / back cover |
| `C`, or the grid button | Contents, grouped by section |
| Double-click a page, or the zoom button | Full-resolution zoom with pan and pinch |
| `F` | Fullscreen |
| The link button | Copies a link to the page on screen |

Each page carries its number below its outer corner, and the bar underneath the
book shows the spread and section you are on.

## Publishing on GitHub Pages

Settings → Pages → Source: *Deploy from a branch*, branch `main`, folder
`/docs`. The book is then at `https://<user>.github.io/<repo>/`, and the embed
URLs are `…/embed.js` and `…/flipbook.html`.

Any other static host works the same way — upload the contents of `docs/`.

## Rebuilding the pages

When the catalog changes, replace the files in `source-pdfs/` (they are ordered
by the number at the start of the filename), update `PAGE_META` in
`tools/build_pages.py` so titles and sections match, then:

```sh
pip install pymupdf pillow
python3 tools/build_pages.py
```

That re-renders every page, thumbnail, blur placeholder, the merged
`catalog.pdf` and `manifest.json`. The viewer reads the manifest at runtime, so
nothing else needs editing — the page count, contents and numbering all follow.

The script refuses to run if `PAGE_META` and the PDFs disagree on the page
count, so the contents list cannot silently drift out of step with the artwork.

## Licence

Catalog artwork and the Warning Lites brand are © Warning Lites of Minnesota.
Barlow and Barlow Condensed are used under the SIL Open Font License 1.1.

## Standalone build for a Claude Artifact

`tools/build_artifact.py` bundles the whole reader into one self-contained HTML
file — stylesheet, script, fonts and all 21 pages inlined as data URIs, the
manifest embedded rather than fetched:

```sh
python3 tools/build_artifact.py       # -> artifact/flipbook-artifact.html
```

Artifacts run under a strict CSP that blocks every external request, and the
sandbox makes page-initiated downloads inert, so that build drops the PDF
download and copy-link buttons and follows the *viewer's* light/dark theme
instead of the `theme` parameter. It reports its size against the 16 MB
artifact limit (currently ~4.4 MB).
