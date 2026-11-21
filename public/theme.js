try {
  var stored = localStorage.getItem("snapjaw-theme");
  if (stored === "light" || stored === "dark") document.documentElement.dataset.theme = stored;
} catch (error) {
  document.documentElement.removeAttribute("data-theme");
}
