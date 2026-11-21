import { createSignal, onMount } from "@krate/runtime";

type Theme = "system" | "light" | "dark";

const order: Theme[] = ["system", "light", "dark"];

function apply(theme: Theme) {
  const root = document.documentElement;
  if (theme === "system") delete root.dataset.theme;
  else root.dataset.theme = theme;
  try {
    if (theme === "system") localStorage.removeItem("snapjaw-theme");
    else localStorage.setItem("snapjaw-theme", theme);
  } catch {
    return;
  }
}

export function ThemeToggle() {
  const [theme, setTheme] = createSignal<Theme>("system");
  onMount(() => {
    const current = document.documentElement.dataset.theme;
    setTheme(current === "light" || current === "dark" ? current : "system");
  });
  function next() {
    const value = order[(order.indexOf(theme()) + 1) % order.length]!;
    setTheme(value);
    apply(value);
  }
  return (
    <button type="button" class="icon-button" onClick={() => next()} aria-label={`Theme: ${theme()}. Change theme`} title={`Theme: ${theme()}`}>
      <span class="icon-slot" hidden={!(theme() === "system")}><Icon name="lucide:monitor" /></span>
      <span class="icon-slot" hidden={!(theme() === "light")}><Icon name="lucide:sun" /></span>
      <span class="icon-slot" hidden={!(theme() === "dark")}><Icon name="lucide:moon" /></span>
    </button>
  );
}
