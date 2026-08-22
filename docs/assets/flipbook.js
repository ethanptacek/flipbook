/* ==========================================================================
   Warning Lites flipbook viewer
   --------------------------------------------------------------------------
   A dependency-free page-turn reader.

   The book is modelled as a run of "states".  In spread mode a state is the
   pair of pages you can see at once, in single mode it is one page:

       spread   state 0 -> [ ---- , p1 ]      (cover, alone)
                state k -> [ p2k  , p2k+1 ]
       single   state k -> [ ---- , p(k+1) ]

   Turning between two adjacent states always looks the same, whichever way
   you go.  Given the earlier state A and the later state B:

       the sheets lying flat are   left = A.left,  right = B.right
       the leaf that turns has     front = A.right, back  = B.left

   ...so one code path drives forward turns, backward turns, drag-to-turn and
   both layout modes.  Only the direction of the angle sweep changes.
   ========================================================================== */

(function () {
  "use strict";

  var TURN_MS = 780;      // duration of one page turn
  var DRAG_DONE = 0.3;    // fraction of a turn a drag must pass to complete
  var TAP_SLOP = 7;       // px of movement still counted as a tap

  var root = document.querySelector(".fb");
  if (!root) return;

  var el = {
    stage:    root.querySelector(".fb-stage"),
    book:     root.querySelector(".fb-book"),
    left:     root.querySelector(".fb-side--left"),
    right:    root.querySelector(".fb-side--right"),
    flipper:  root.querySelector(".fb-flipper"),
    front:    root.querySelector(".fb-face--front"),
    back:     root.querySelector(".fb-face--back"),
    counterN: root.querySelector(".fb-counter__n"),
    counterT: root.querySelector(".fb-counter__t"),
    progress: root.querySelector(".fb-progress > i"),
    drawer:   root.querySelector(".fb-drawer"),
    thumbs:   root.querySelector(".fb-drawer__body"),
    lightbox: root.querySelector(".fb-lightbox"),
    lbView:   root.querySelector(".fb-lightbox__view"),
    lbImg:    root.querySelector(".fb-lightbox__view img"),
    lbLabel:  root.querySelector(".fb-lightbox__label"),
    lbLevel:  root.querySelector(".fb-zoomlevel"),
    toast:    root.querySelector(".fb-toast"),
    boot:     root.querySelector(".fb-boot"),
    bootErr:  root.querySelector(".fb-boot__err"),
    title:    root.querySelector(".fb-brand__title"),
    mark:     root.querySelector(".fb-brand__mark"),
    download: root.querySelector('[data-act="download"]')
  };

  var prevBtns = Array.prototype.slice.call(root.querySelectorAll('[data-act="prev"]'));
  var nextBtns = Array.prototype.slice.call(root.querySelectorAll('[data-act="next"]'));

  /* ----------------------------------------------------------- config -- */

  var qs = new URLSearchParams(location.search);
  var cfg = Object.assign({
    manifest: "pages/manifest.json",
    page: 1,
    theme: "dark",
    mode: "auto"          // "auto" | "spread" | "single"
  }, window.FLIPBOOK_CONFIG || {});

  ["manifest", "theme", "mode"].forEach(function (k) {
    if (qs.get(k)) cfg[k] = qs.get(k);
  });
  var hashPage = /page=(\d+)/.exec(location.hash || "");
  if (qs.get("page")) cfg.page = parseInt(qs.get("page"), 10);
  else if (hashPage) cfg.page = parseInt(hashPage[1], 10);

  root.setAttribute("data-theme", cfg.theme === "light" ? "light" : "dark");

  /* ------------------------------------------------------------ state -- */

  var book = null;          // manifest
  var pages = [];           // manifest.pages
  var ASPECT = 11 / 8.5;    // page height / width
  var mode = "spread";
  var index = 0;
  var pageW = 0;
  var useWebp = true;
  var busy = false;         // a turn is running or being dragged
  var flipShift = null;     // book slide interpolated across the current turn
  var rafId = 0;
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function stateCount() {
    return mode === "single" ? pages.length : Math.ceil((pages.length + 1) / 2);
  }

  function stateAt(i) {
    if (mode === "single") return { left: null, right: pages[i] || null };
    return {
      left: i === 0 ? null : pages[2 * i - 1] || null,
      right: pages[2 * i] || null
    };
  }

  /** 1-based page number -> the state that shows it. */
  function stateOfPage(p) {
    p = Math.min(Math.max(p, 1), pages.length);
    return mode === "single" ? p - 1 : Math.floor(p / 2);
  }

  /** the lowest page number visible in a state (used when switching modes). */
  function firstPageOf(i) {
    var s = stateAt(i);
    return (s.left || s.right || pages[0]).n;
  }

  function clampIndex(i) {
    return Math.min(Math.max(i, 0), stateCount() - 1);
  }

  /* ----------------------------------------------------------- images -- */

  function srcFor(page) {
    return page ? (useWebp ? page.src : page.fallback) : "";
  }

  var preloaded = Object.create(null);
  function preload(page) {
    if (!page) return;
    var url = srcFor(page);
    if (preloaded[url]) return;
    preloaded[url] = new Image();
    preloaded[url].src = url;
  }

  function preloadAround(i) {
    for (var k = i - 2; k <= i + 2; k++) {
      if (k < 0 || k >= stateCount()) continue;
      var s = stateAt(k);
      preload(s.left);
      preload(s.right);
    }
  }

  /** Warm the whole catalog once the first spread is on screen. */
  function preloadRest() {
    var i = 0;
    (function step() {
      if (i >= pages.length) return;
      preload(pages[i++]);
      if (window.requestIdleCallback) window.requestIdleCallback(step, { timeout: 400 });
      else setTimeout(step, 120);
    })();
  }

  function paint(target, page) {
    var img = target.querySelector("img");
    var folio = target.querySelector(".fb-folio");
    if (!page) {
      target.classList.add("is-empty");
      img.removeAttribute("src");
      target.style.backgroundImage = "";
      if (folio) folio.textContent = "";
      return;
    }
    target.classList.remove("is-empty");
    target.style.backgroundImage = 'url("' + page.blur + '")';
    var url = srcFor(page);
    if (img.getAttribute("src") !== url) {
      img.setAttribute("src", url);
      img.setAttribute("alt", "Page " + page.n + " — " + page.title);
    }
    if (folio) folio.textContent = pad(page.n);
  }

  function pad(n) { return n < 10 ? "0" + n : String(n); }

  /* ----------------------------------------------------------- layout -- */

  /** Largest page width that fits `cols` pages in the given box. */
  function fitPage(cols, availW, availH) {
    return Math.floor(Math.min(availW / cols, availH / ASPECT));
  }

  /**
   * Spread wherever it is readable.  Dropping to one page is only worth it
   * when it actually buys a meaningfully larger page — on a short, wide embed
   * the height caps both layouts at the same size, and there the spread shows
   * twice the catalog for free.
   */
  function pickMode(w, spreadW, singleW) {
    if (cfg.mode === "spread" || cfg.mode === "single") return cfg.mode;
    if (w < 680) return "single";
    return spreadW < 340 && singleW > spreadW * 1.2 ? "single" : "spread";
  }

  function layout() {
    var cs = getComputedStyle(el.stage);
    var availW = el.stage.clientWidth
      - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    var availH = el.stage.clientHeight
      - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);

    // leave room for the stage arrows so they never sit on the artwork
    if (root.clientWidth > 720) availW -= 132;

    var spreadW = fitPage(2, availW, availH);
    var singleW = fitPage(1, availW, availH);

    var next = pickMode(root.clientWidth, spreadW, singleW);
    if (next !== mode) {
      var keep = pages.length ? firstPageOf(index) : 1;
      mode = next;
      root.setAttribute("data-mode", mode);
      index = clampIndex(stateOfPage(keep));
    }

    pageW = Math.max(90, mode === "spread" ? spreadW : singleW);
    var cols = mode === "spread" ? 2 : 1;

    root.classList.add("is-resizing");
    root.style.setProperty("--fb-pw", pageW + "px");
    root.style.setProperty("--fb-ph", Math.round(pageW * ASPECT) + "px");
    root.style.setProperty("--fb-cols", cols);
    // eslint-disable-next-line no-unused-expressions
    root.offsetHeight;
    root.classList.remove("is-resizing");
  }

  /* ------------------------------------------------------ rendering -- */

  /**
   * How far the book slides so a lone cover sits centred on the stage,
   * as a percentage of the full two-page width.
   */
  function shiftFor(i) {
    if (mode !== "spread") return 0;
    var s = stateAt(i);
    if (!s.left) return -25;
    if (!s.right) return 25;
    return 0;
  }

  function setShift(pct) {
    root.style.setProperty("--fb-shift", pct + "%");
  }

  function render() {
    var s = stateAt(index);
    paint(el.left, s.left);
    paint(el.right, s.right);
    setShift(shiftFor(index));

    // block of un-turned sheets on each side
    var lo = s.left ? s.left.n : (s.right ? s.right.n : 1);
    var hi = s.right ? s.right.n : (s.left ? s.left.n : 1);
    setStack(el.left, lo - 1);
    setStack(el.right, pages.length - hi);

    updateChrome();
    preloadAround(index);
  }

  function setStack(side, sheets) {
    var stack = side.querySelector(".fb-stack");
    if (!stack) return;
    stack.style.width = Math.min(14, Math.max(0, sheets * 0.7)).toFixed(1) + "px";
  }

  function updateChrome() {
    var s = stateAt(index);
    var shown = [s.left, s.right].filter(Boolean);
    var first = shown[0], last = shown[shown.length - 1];

    el.counterN.innerHTML = shown.length > 1
      ? "Pages <b>" + pad(first.n) + "–" + pad(last.n) + "</b> / " + pages.length
      : "Page <b>" + pad(first.n) + "</b> / " + pages.length;

    var sections = shown.map(function (p) { return p.section; })
      .filter(function (v, i, a) { return a.indexOf(v) === i; });
    el.counterT.textContent = sections.join(" · ");

    var atStart = index === 0;
    var atEnd = index === stateCount() - 1;
    prevBtns.forEach(function (b) { b.disabled = atStart; });
    nextBtns.forEach(function (b) { b.disabled = atEnd; });

    var pct = stateCount() > 1 ? (index / (stateCount() - 1)) * 100 : 100;
    el.progress.style.width = pct.toFixed(2) + "%";

    root.querySelectorAll(".fb-thumb").forEach(function (t) {
      var n = parseInt(t.dataset.page, 10);
      t.setAttribute("aria-current", shown.some(function (p) { return p.n === n; }));
    });

    try {
      history.replaceState(null, "", "#page=" + first.n);
    } catch (e) { /* sandboxed iframe — the hash is a nicety, not a requirement */ }

    post("page", { page: first.n, pages: pages.length, mode: mode });
  }

  /* ------------------------------------------------------- turn engine -- */

  /**
   * Stage the DOM for a turn between two adjacent states and return the
   * angle range.  Identical for both directions — see the file header.
   */
  function stage(from, to) {
    var lower = Math.min(from, to);
    var A = stateAt(lower);
    var B = stateAt(lower + 1);

    paint(el.left, A.left);
    paint(el.right, B.right);
    paint(el.front, A.right);
    paint(el.back, B.left);

    setStack(el.left, (A.left ? A.left.n : 1) - 1);
    setStack(el.right, pages.length - (B.right ? B.right.n : pages.length));

    // angle 0 shows the earlier state, -180 the later one, so the slide can be
    // driven straight off the sweep and stays correct for drags too
    flipShift = { a: shiftFor(lower), b: shiftFor(lower + 1) };

    root.classList.add("is-flipping");
    return { start: from < to ? 0 : -180, end: from < to ? -180 : 0 };
  }

  function applyAngle(a) {
    el.flipper.style.transform = "rotateY(" + a + "deg)";

    var t0 = Math.abs(a) / 180;
    if (flipShift) setShift(flipShift.a + (flipShift.b - flipShift.a) * t0);

    var rad = a * Math.PI / 180;
    var shade = (1 - Math.abs(Math.cos(rad))) * 0.72;
    el.front.querySelector(".fb-shade").style.opacity = shade;
    el.back.querySelector(".fb-shade").style.opacity = shade;

    var t = Math.abs(a) / 180;
    var swell = Math.sin(t * Math.PI) * 1.15;
    el.right.querySelector(".fb-cast").style.opacity = (1 - t) * swell;
    el.left.querySelector(".fb-cast").style.opacity = mode === "single" ? 0 : t * swell;
  }

  function clearFlip() {
    flipShift = null;
    root.classList.remove("is-flipping");
    el.flipper.style.transform = "";
    el.left.querySelector(".fb-cast").style.opacity = 0;
    el.right.querySelector(".fb-cast").style.opacity = 0;
  }

  function easeInOutCubic(p) {
    return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
  }

  function sweep(from, to, ms, done) {
    cancelAnimationFrame(rafId);
    if (reduceMotion || ms <= 0) { applyAngle(to); done(); return; }
    var t0 = performance.now();
    rafId = requestAnimationFrame(function frame(now) {
      var p = Math.min(1, (now - t0) / ms);
      applyAngle(from + (to - from) * easeInOutCubic(p));
      if (p < 1) rafId = requestAnimationFrame(frame);
      else done();
    });
  }

  /** Turn to an adjacent state; non-adjacent targets cut straight there. */
  function goTo(target, animated) {
    target = clampIndex(target);
    if (busy || target === index || !pages.length) return;

    if (animated === false || Math.abs(target - index) !== 1) {
      index = target;
      clearFlip();
      render();
      return;
    }

    busy = true;
    var range = stage(index, target);
    applyAngle(range.start);
    // let the staged frame paint before the sweep begins
    requestAnimationFrame(function () {
      sweep(range.start, range.end, TURN_MS, function () {
        index = target;
        busy = false;
        clearFlip();
        render();
      });
    });
  }

  function next() { goTo(index + 1); }
  function prev() { goTo(index - 1); }
  function goToPage(n) { goTo(stateOfPage(n), Math.abs(stateOfPage(n) - index) === 1); }

  /* --------------------------------------------------- drag to turn -- */

  var drag = null;

  el.stage.addEventListener("pointerdown", function (e) {
    if (busy || !pages.length || e.button > 0) return;
    if (e.target.closest("button, a")) return;

    var rect = el.book.getBoundingClientRect();
    if (e.clientY < rect.top - 40 || e.clientY > rect.bottom + 40) return;

    var forward = mode === "single"
      ? e.clientX > rect.left + rect.width * 0.32
      : e.clientX > rect.left + rect.width / 2;
    var target = forward ? index + 1 : index - 1;
    if (target < 0 || target >= stateCount()) return;

    busy = true;
    var range = stage(index, target);
    applyAngle(range.start);

    drag = {
      id: e.pointerId, x0: e.clientX, y0: e.clientY,
      forward: forward, target: target, range: range,
      progress: 0, moved: 0
    };
    el.stage.setPointerCapture(e.pointerId);
  });

  el.stage.addEventListener("pointermove", function (e) {
    if (!drag || e.pointerId !== drag.id) return;
    var dx = e.clientX - drag.x0;
    drag.moved = Math.max(drag.moved, Math.abs(dx), Math.abs(e.clientY - drag.y0));
    if (drag.moved < TAP_SLOP) return;

    var travel = drag.forward ? -dx : dx;
    drag.progress = Math.min(1, Math.max(0, travel / Math.max(1, pageW)));
    applyAngle(drag.range.start + (drag.range.end - drag.range.start) * drag.progress);
  });

  function endDrag(e) {
    if (!drag || (e && e.pointerId !== drag.id)) return;
    var d = drag;
    drag = null;
    try { el.stage.releasePointerCapture(d.id); } catch (err) { /* already gone */ }

    var complete = d.moved < TAP_SLOP || d.progress > DRAG_DONE;
    var from = d.range.start + (d.range.end - d.range.start) * d.progress;
    var to = complete ? d.range.end : d.range.start;
    var ms = TURN_MS * Math.abs(to - from) / 180;

    sweep(from, to, Math.max(160, ms), function () {
      if (complete) index = d.target;
      busy = false;
      clearFlip();
      render();
    });
  }

  el.stage.addEventListener("pointerup", endDrag);
  el.stage.addEventListener("pointercancel", endDrag);

  /* -------------------------------------------------------- contents -- */

  function buildThumbs() {
    var html = "";
    var section = null;
    pages.forEach(function (p) {
      if (p.section !== section) {
        if (section !== null) html += "</div>";
        section = p.section;
        html += '<h3 class="fb-section__label"><span>' + esc(section) + "</span></h3>";
        html += '<div class="fb-thumbs">';
      }
      html +=
        '<button class="fb-thumb" type="button" data-page="' + p.n + '">' +
          '<span class="fb-thumb__img">' +
            '<img loading="lazy" src="' + p.thumb + '" alt="">' +
          "</span>" +
          '<span class="fb-thumb__meta">' +
            '<span class="fb-thumb__n">' + pad(p.n) + "</span>" +
            '<span class="fb-thumb__t">' + esc(p.title) + "</span>" +
          "</span>" +
        "</button>";
    });
    html += "</div>";
    el.thumbs.innerHTML = html;

    el.thumbs.addEventListener("click", function (e) {
      var btn = e.target.closest(".fb-thumb");
      if (!btn) return;
      goToPage(parseInt(btn.dataset.page, 10));
      toggleDrawer(false);
    });
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function toggleDrawer(on) {
    var open = on === undefined ? !root.classList.contains("is-drawer-open") : on;
    root.classList.toggle("is-drawer-open", open);
    root.querySelector('[data-act="contents"]').setAttribute("aria-pressed", open);
    if (open) {
      var cur = el.thumbs.querySelector('[aria-current="true"]');
      if (cur) cur.scrollIntoView({ block: "center" });
    }
  }

  /* ------------------------------------------------------------ zoom -- */

  var zoom = { page: null, scale: 1, fit: 1, x: 0, y: 0, pointers: {}, pinch: 0 };

  function openZoom(page) {
    zoom.page = page || stateAt(index).right || stateAt(index).left;
    if (!zoom.page) return;
    el.lbLabel.textContent = "Page " + pad(zoom.page.n) + " — " + zoom.page.title;
    el.lbImg.src = srcFor(zoom.page);
    root.classList.add("is-zoom-open");
    var apply = function () { fitZoom(); };
    if (el.lbImg.complete && el.lbImg.naturalWidth) apply();
    else el.lbImg.onload = apply;
  }

  function closeZoom() {
    root.classList.remove("is-zoom-open");
    zoom.pointers = {};
    el.lbView.classList.remove("is-panning");
  }

  function fitZoom() {
    var vw = el.lbView.clientWidth, vh = el.lbView.clientHeight;
    var nw = el.lbImg.naturalWidth || 1, nh = el.lbImg.naturalHeight || 1;
    zoom.fit = Math.min(vw / nw, vh / nh) * 0.96;
    zoom.scale = zoom.fit;
    zoom.x = (vw - nw * zoom.scale) / 2;
    zoom.y = (vh - nh * zoom.scale) / 2;
    applyZoom();
  }

  function applyZoom() {
    var vw = el.lbView.clientWidth, vh = el.lbView.clientHeight;
    var w = el.lbImg.naturalWidth * zoom.scale;
    var h = el.lbImg.naturalHeight * zoom.scale;
    zoom.x = w <= vw ? (vw - w) / 2 : Math.min(0, Math.max(vw - w, zoom.x));
    zoom.y = h <= vh ? (vh - h) / 2 : Math.min(0, Math.max(vh - h, zoom.y));
    el.lbImg.style.transform =
      "translate(" + zoom.x + "px," + zoom.y + "px) scale(" + zoom.scale + ")";
    el.lbLevel.textContent = Math.round((zoom.scale / zoom.fit) * 100) + "%";
  }

  function zoomAt(factor, cx, cy) {
    var prevScale = zoom.scale;
    zoom.scale = Math.min(zoom.fit * 6, Math.max(zoom.fit, zoom.scale * factor));
    var k = zoom.scale / prevScale;
    zoom.x = cx - (cx - zoom.x) * k;
    zoom.y = cy - (cy - zoom.y) * k;
    applyZoom();
  }

  el.lbView.addEventListener("wheel", function (e) {
    e.preventDefault();
    var r = el.lbView.getBoundingClientRect();
    zoomAt(Math.pow(0.998, e.deltaY), e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });

  el.lbView.addEventListener("dblclick", function (e) {
    var r = el.lbView.getBoundingClientRect();
    if (zoom.scale > zoom.fit * 1.05) fitZoom();
    else zoomAt(2.4, e.clientX - r.left, e.clientY - r.top);
  });

  el.lbView.addEventListener("pointerdown", function (e) {
    zoom.pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
    el.lbView.setPointerCapture(e.pointerId);
    el.lbView.classList.add("is-panning");
  });

  el.lbView.addEventListener("pointermove", function (e) {
    var p = zoom.pointers[e.pointerId];
    if (!p) return;
    var ids = Object.keys(zoom.pointers);

    if (ids.length >= 2) {
      var a = zoom.pointers[ids[0]], b = zoom.pointers[ids[1]];
      var before = Math.hypot(a.x - b.x, a.y - b.y);
      p.x = e.clientX; p.y = e.clientY;
      var after = Math.hypot(a.x - b.x, a.y - b.y);
      if (before > 0 && after > 0) {
        var r = el.lbView.getBoundingClientRect();
        zoomAt(after / before, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
      }
      return;
    }

    zoom.x += e.clientX - p.x;
    zoom.y += e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    applyZoom();
  });

  function endZoomPointer(e) {
    delete zoom.pointers[e.pointerId];
    try { el.lbView.releasePointerCapture(e.pointerId); } catch (err) { /* gone */ }
    if (!Object.keys(zoom.pointers).length) el.lbView.classList.remove("is-panning");
  }
  el.lbView.addEventListener("pointerup", endZoomPointer);
  el.lbView.addEventListener("pointercancel", endZoomPointer);

  function stepZoomPage(delta) {
    var n = zoom.page.n + delta;
    if (n < 1 || n > pages.length) return;
    goToPage(n);
    openZoom(pages[n - 1]);
  }

  /* ------------------------------------------------------ fullscreen -- */

  function fullscreenEl() {
    return document.fullscreenElement || document.webkitFullscreenElement || null;
  }

  function toggleFullscreen() {
    if (fullscreenEl()) {
      (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    } else {
      var fn = root.requestFullscreen || root.webkitRequestFullscreen;
      if (!fn) { toast("Fullscreen is blocked on this page"); return; }
      var res = fn.call(root);
      if (res && res.catch) res.catch(function () { toast("Fullscreen is blocked on this page"); });
    }
  }

  ["fullscreenchange", "webkitfullscreenchange"].forEach(function (ev) {
    document.addEventListener(ev, function () {
      var on = !!fullscreenEl();
      var btn = root.querySelector('[data-act="fullscreen"]');
      btn.setAttribute("aria-pressed", on);
      btn.querySelector("use").setAttribute("href", on ? "#i-minimize" : "#i-maximize");
      btn.setAttribute("data-tip", on ? "Exit fullscreen" : "Fullscreen");
      setTimeout(layout, 60);
    });
  });

  /* ----------------------------------------------------------- share -- */

  function shareLink() {
    var url = location.origin + location.pathname + "?page=" + firstPageOf(index);
    var done = function () { toast("Link copied to clipboard"); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(done, function () { legacyCopy(url, done); });
    } else {
      legacyCopy(url, done);
    }
  }

  function legacyCopy(text, done) {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:absolute;left:-9999px";
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    if (ok) done(); else toast(text);
  }

  var toastTimer = 0;
  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.classList.add("is-on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.toast.classList.remove("is-on"); }, 2200);
  }

  /* -------------------------------------------------------- controls -- */

  root.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-act]");
    if (!btn) return;
    switch (btn.dataset.act) {
      case "prev": prev(); break;
      case "next": next(); break;
      case "contents": toggleDrawer(); break;
      case "close-drawer": toggleDrawer(false); break;
      case "zoom": openZoom(); break;
      case "close-zoom": closeZoom(); break;
      case "zoom-in": zoomAt(1.35, el.lbView.clientWidth / 2, el.lbView.clientHeight / 2); break;
      case "zoom-out": zoomAt(1 / 1.35, el.lbView.clientWidth / 2, el.lbView.clientHeight / 2); break;
      case "zoom-fit": fitZoom(); break;
      case "zoom-prev": stepZoomPage(-1); break;
      case "zoom-next": stepZoomPage(1); break;
      case "fullscreen": toggleFullscreen(); break;
      case "share": shareLink(); break;
      default: break;
    }
  });

  // double-clicking a page opens it at full resolution
  el.stage.addEventListener("dblclick", function (e) {
    var side = e.target.closest(".fb-side");
    if (!side) return;
    var s = stateAt(index);
    openZoom(side.classList.contains("fb-side--left") ? s.left : s.right);
  });

  document.addEventListener("keydown", function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    var zoomOpen = root.classList.contains("is-zoom-open");

    switch (e.key) {
      case "ArrowRight": case "PageDown": case " ":
        zoomOpen ? stepZoomPage(1) : next(); e.preventDefault(); break;
      case "ArrowLeft": case "PageUp":
        zoomOpen ? stepZoomPage(-1) : prev(); e.preventDefault(); break;
      case "Home": goTo(0, false); e.preventDefault(); break;
      case "End": goTo(stateCount() - 1, false); e.preventDefault(); break;
      case "Escape":
        if (zoomOpen) closeZoom();
        else if (root.classList.contains("is-drawer-open")) toggleDrawer(false);
        else if (fullscreenEl()) toggleFullscreen();
        break;
      case "c": case "C": if (!zoomOpen) toggleDrawer(); break;
      case "f": case "F": toggleFullscreen(); break;
      case "+": case "=": if (zoomOpen) zoomAt(1.35, el.lbView.clientWidth / 2, el.lbView.clientHeight / 2); break;
      case "-": if (zoomOpen) zoomAt(1 / 1.35, el.lbView.clientWidth / 2, el.lbView.clientHeight / 2); break;
      default: break;
    }
  });

  /* ------------------------------------------------- host page bridge -- */

  function post(type, data) {
    if (window.parent === window) return;
    try {
      window.parent.postMessage(Object.assign(
        { source: "warning-lites-flipbook", type: type }, data || {}
      ), "*");
    } catch (e) { /* cross-origin parent that refuses messages */ }
  }

  window.addEventListener("message", function (e) {
    var d = e.data;
    if (!d || d.target !== "warning-lites-flipbook") return;
    if (d.action === "goto") goToPage(parseInt(d.page, 10) || 1);
    if (d.action === "next") next();
    if (d.action === "prev") prev();
  });

  /* ------------------------------------------------------------- boot -- */

  function detectWebp() {
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () { resolve(img.width === 2); };
      img.onerror = function () { resolve(false); };
      img.src = "data:image/webp;base64,UklGRi4AAABXRUJQVlA4TCEAAAAvAUAAEB8w" +
                "AiMwAgSSNtse/cXjxyCCmrYNWPwmHRH9jwMA";
    });
  }

  function fail(msg) {
    el.boot.classList.add("has-error");
    el.bootErr.textContent = msg;
    el.bootErr.hidden = false;
    var bar = el.boot.querySelector(".fb-boot__bar");
    if (bar) bar.hidden = true;
  }

  Promise.all([
    fetch(cfg.manifest, { cache: "default" }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }),
    detectWebp()
  ]).then(function (out) {
    book = out[0];
    useWebp = out[1];
    pages = book.pages || [];
    if (!pages.length) throw new Error("the manifest lists no pages");

    ASPECT = book.aspect || ASPECT;
    if (book.brand) el.mark.textContent = book.brand;
    if (book.title) {
      el.title.textContent = book.title;
      document.title = book.brand
        ? book.brand + " — " + book.title
        : book.title;
    }
    if (book.pdf) {
      el.download.setAttribute("href", book.pdf);
      el.download.setAttribute("data-tip",
        "Download the PDF" + (book.pdfSize ? " (" + book.pdfSize + ")" : ""));
    }

    buildThumbs();
    layout();   // settles data-mode, which decides how pages map to states
    index = clampIndex(stateOfPage(parseInt(cfg.page, 10) || 1));
    render();
    root.classList.add("is-ready");

    post("ready", { pages: pages.length, page: firstPageOf(index) });
    setTimeout(preloadRest, 700);
  }).catch(function (err) {
    fail("Could not load the catalog (" + err.message + "). If you are opening " +
         "this file directly from disk, serve the folder over http instead.");
  });

  var resizeTimer = 0;
  var ro = new ResizeObserver(function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      if (!pages.length) return;
      layout();
      render();
      if (root.classList.contains("is-zoom-open")) fitZoom();
    }, 90);
  });
  ro.observe(root);
})();
