/* ==========================================================================
   Warning Lites flipbook — embed loader
   --------------------------------------------------------------------------
   Drop this on any page:

       <div data-warning-lites-flipbook></div>
       <script src="https://YOUR-HOST/embed.js" defer></script>

   It replaces every matching element with a responsive, sandboxed iframe of
   the viewer and keeps the height in step with the container width, so the
   book never ends up cramped or floating in dead space.

   Optional attributes on the container:

       data-page="7"            open on a page          (default 1)
       data-theme="light"       dark | light            (default dark)
       data-mode="single"       auto | spread | single  (default auto)
       data-height="700"        fixed px height, disables auto-sizing
       data-min-height="420"    auto-size floor         (default 420)
       data-max-height="900"    auto-size ceiling       (default 900)
       data-radius="14"         corner radius in px     (default 14)

   After it runs, window.WarningLitesFlipbook exposes { goto, next, prev,
   frames } for driving the book from the host page.
   ========================================================================== */

(function () {
  "use strict";

  var CHANNEL = "warning-lites-flipbook";
  var SELECTOR = "[data-warning-lites-flipbook], [data-wl-flipbook], .warning-lites-flipbook";
  var PAGE_RATIO = 11 / 8.5;   // page height / width

  var me = document.currentScript ||
    (function () {
      var all = document.getElementsByTagName("script");
      for (var i = all.length - 1; i >= 0; i--) {
        if (/embed\.js(\?|$)/.test(all[i].src || "")) return all[i];
      }
      return null;
    })();

  var BASE = me && me.src
    ? me.src.replace(/[^/]*$/, "")
    : "./";

  var frames = [];

  function attr(node, name, fallback) {
    var v = node.getAttribute("data-" + name);
    return v === null || v === "" ? fallback : v;
  }

  function num(v, fallback) {
    var n = parseInt(v, 10);
    return isNaN(n) ? fallback : n;
  }

  /**
   * Height that lets the pages render as large as the width allows.
   * Mirrors the viewer's own fit: chrome (bars) + stage padding + page height.
   */
  function idealHeight(width, mode) {
    var wide = width > 720;                       // above this the arrows show
    var availW = width - (wide ? 40 : 16) - (wide ? 132 : 0);
    var spread = mode === "spread" ||
      (mode !== "single" && width >= 680 && availW / 2 >= 340);
    var pageW = Math.max(120, spread ? availW / 2 : availW);
    // chrome: top bar + bottom bar + progress rule + the stage's own padding
    return Math.round(pageW * PAGE_RATIO) + (wide ? 197 : 147);
  }

  function mount(host) {
    if (host.getAttribute("data-wl-mounted")) return;
    host.setAttribute("data-wl-mounted", "1");

    var mode = attr(host, "mode", "auto");
    var fixed = num(attr(host, "height", ""), 0);
    var minH = num(attr(host, "min-height", ""), 420);
    var maxH = num(attr(host, "max-height", ""), 900);
    var radius = num(attr(host, "radius", ""), 14);

    var params = "?page=" + encodeURIComponent(attr(host, "page", "1")) +
      "&theme=" + encodeURIComponent(attr(host, "theme", "dark")) +
      "&mode=" + encodeURIComponent(mode) +
      "&embed=1";

    var frame = document.createElement("iframe");
    frame.src = BASE + "flipbook.html" + params;
    frame.title = attr(host, "title", "Warning Lites 2026 Product Catalog");
    frame.loading = "lazy";
    frame.setAttribute("allow", "fullscreen; clipboard-write");
    frame.setAttribute("allowfullscreen", "");
    frame.setAttribute("scrolling", "no");
    frame.style.cssText =
      "display:block;width:100%;height:100%;border:0;background:#0E0F11";

    var box = document.createElement("div");
    box.style.cssText =
      "position:relative;width:100%;overflow:hidden;background:#0E0F11;" +
      "border-radius:" + radius + "px";

    box.appendChild(frame);
    host.innerHTML = "";
    host.appendChild(box);

    function resize() {
      var w = host.clientWidth || box.clientWidth || 0;
      if (!w) return;
      var h = fixed || Math.min(maxH, Math.max(minH, idealHeight(w, mode)));
      box.style.height = h + "px";
    }

    resize();

    if (window.ResizeObserver) {
      new ResizeObserver(resize).observe(host);
    } else {
      window.addEventListener("resize", resize);
    }

    frames.push(frame);
    return frame;
  }

  function send(action, payload) {
    frames.forEach(function (f) {
      if (!f.contentWindow) return;
      try {
        f.contentWindow.postMessage(
          Object.assign({ target: CHANNEL, action: action }, payload || {}), "*"
        );
      } catch (e) { /* frame not ready yet */ }
    });
  }

  function boot() {
    var hosts = document.querySelectorAll(SELECTOR);
    if (!hosts.length) return;
    Array.prototype.forEach.call(hosts, mount);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  window.WarningLitesFlipbook = {
    mount: mount,
    refresh: boot,
    frames: frames,
    goto: function (page) { send("goto", { page: page }); },
    next: function () { send("next"); },
    prev: function () { send("prev"); },
    /** Listen for page changes: onPage(function (page, total) { ... }) */
    onPage: function (fn) {
      window.addEventListener("message", function (e) {
        var d = e.data;
        if (d && d.source === CHANNEL && (d.type === "page" || d.type === "ready")) {
          fn(d.page, d.pages);
        }
      });
    }
  };
})();
