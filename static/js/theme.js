(function () {
  var KEY = "vantum_theme";
  function apply(t) {
    document.body.setAttribute("data-theme", t);
    var btn = document.getElementById("themeToggle");
    if (btn) btn.textContent = t === "light" ? "☀️" : "🌙";
  }
  apply(localStorage.getItem(KEY) || "dark");
  document.addEventListener("click", function (e) {
    var t = e.target.closest && e.target.closest("#themeToggle");
    if (!t) return;
    var next = document.body.getAttribute("data-theme") === "light" ? "dark" : "light";
    try { localStorage.setItem(KEY, next); } catch (e) {}
    apply(next);
  });
})();
