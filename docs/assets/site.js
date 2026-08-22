/* Landing page behaviour: real embed URLs in the snippets, copy buttons,
   tabs, and scroll reveals. */
(function () {
  "use strict";

  /* Snippets ship with a __BASE__ placeholder so the copied code points at
     wherever this page actually lives — no hand-editing before pasting. */
  var base = new URL(".", location.href).href;
  document.querySelectorAll(".code code").forEach(function (block) {
    if (block.innerHTML.indexOf("__BASE__") === -1) return;
    block.innerHTML = block.innerHTML.replace(/__BASE__/g, base);
  });

  document.querySelectorAll(".copy").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var text = btn.parentElement.querySelector("code").innerText;
      var done = function () {
        btn.textContent = "Copied";
        btn.classList.add("is-done");
        setTimeout(function () {
          btn.textContent = "Copy";
          btn.classList.remove("is-done");
        }, 1400);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, function () { fallback(text, done); });
      } else {
        fallback(text, done);
      }
    });
  });

  function fallback(text, done) {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.style.cssText = "position:fixed;left:-9999px";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); done(); } catch (e) { /* nothing to do */ }
    document.body.removeChild(ta);
  }

  var tabs = document.querySelectorAll(".tab");
  tabs.forEach(function (tab) {
    tab.addEventListener("click", function () {
      tabs.forEach(function (t) {
        var on = t === tab;
        t.classList.toggle("is-on", on);
        t.setAttribute("aria-selected", String(on));
      });
      document.querySelectorAll(".panel").forEach(function (p) {
        p.classList.toggle("is-on", p.dataset.panel === tab.dataset.tab);
      });
    });
  });

  if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches && window.IntersectionObserver) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        e.target.style.transition = "opacity .6s var(--ease), transform .6s var(--ease)";
        e.target.style.opacity = 1;
        e.target.style.transform = "none";
        io.unobserve(e.target);
      });
    }, { threshold: 0.12 });

    document.querySelectorAll(".band .wrap > *").forEach(function (node, i) {
      node.style.opacity = 0;
      node.style.transform = "translateY(22px)";
      node.style.transitionDelay = (i % 6) * 55 + "ms";
      io.observe(node);
    });
  }
})();
