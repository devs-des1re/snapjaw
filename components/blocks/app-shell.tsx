import { createSignal, onMount } from "@krate/runtime";
import { signOut } from "@krate/auth/client";
import { LogoMark } from "../ui/logo";
import { ThemeToggle } from "./theme-toggle";
import { api } from "../../lib/client";

type Me = { id: string; email: string | null; name: string | null; role: string };

function initials(me: Me | null): string {
  const source = me?.name || me?.email || "?";
  return source
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("");
}

export function AppShell(props: { children?: unknown }) {
  const [collapsed, setCollapsed] = createSignal(false, { persist: "snapjaw-sidebar" });
  const [menu, setMenu] = createSignal(false);
  const [me, setMe] = createSignal<Me | null>(null);

  onMount(async () => {
    const result = await api.get<Me>("/api/me");
    if (result.ok) setMe(result.data);
  });

  async function logout() {
    await signOut({ callbackUrl: "/login" });
  }

  return (
    <div class="app" data-collapsed={collapsed() ? "true" : "false"} data-menu={menu() ? "open" : "closed"}>
      <a class="skip-link" href="#main">Skip to content</a>
      <button type="button" class="scrim" aria-label="Close menu" tabindex={-1} onClick={() => setMenu(false)} />
      <aside class="sidebar" aria-label="Main">
        <div class="sidebar-head">
          <a class="brand" href="/" aria-label="Snapjaw dashboard">
            <LogoMark />
            <span class="brand-name">Snapjaw</span>
          </a>
          <button
            type="button"
            class="icon-button collapse-toggle"
            aria-label={collapsed() ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={collapsed() ? "false" : "true"}
            onClick={() => setCollapsed(!collapsed())}
          >
            <span class="icon-slot" hidden={!(!collapsed())}><Icon name="lucide:panel-left-close" /></span>
            <span class="icon-slot" hidden={!(collapsed())}><Icon name="lucide:panel-left-open" /></span>
          </button>
          <button type="button" class="icon-button hide-lg" aria-label="Close menu" hidden={!(menu())} onClick={() => setMenu(false)}>
            <Icon name="lucide:x" />
          </button>
        </div>
        <nav class="sidebar-nav" onClick={() => setMenu(false)}>
          <span class="nav-section">Overview</span>
          <Link class="nav-link" href="/" title="Dashboard"><Icon name="lucide:layout-dashboard" /><span class="nav-label">Dashboard</span></Link>
          <Link class="nav-link" href="/messages" title="Messages"><Icon name="lucide:list" /><span class="nav-label">Messages</span></Link>
          <span class="nav-section">Mail</span>
          <Link class="nav-link" href="/domains" title="Domains"><Icon name="lucide:globe" /><span class="nav-label">Domains</span></Link>
          <Link class="nav-link" href="/routes" title="Routes"><Icon name="lucide:split" /><span class="nav-label">Routes</span></Link>
          <Link class="nav-link" href="/destinations" title="Destinations"><Icon name="lucide:inbox" /><span class="nav-label">Destinations</span></Link>
          <Link class="nav-link" href="/credentials" title="Credentials"><Icon name="lucide:key-round" /><span class="nav-label">Credentials</span></Link>
          <Link class="nav-link" href="/suppressions" title="Suppressions"><Icon name="lucide:ban" /><span class="nav-label">Suppressions</span></Link>
          <span class="nav-section">System</span>
          <Link class="nav-link" href="/settings" title="Settings"><Icon name="lucide:sliders-horizontal" /><span class="nav-label">Settings</span></Link>
          <Link class="nav-link" href="/admins" title="Admins"><Icon name="lucide:users" /><span class="nav-label">Admins</span></Link>
          <Link class="nav-link" href="/audit" title="Audit log"><Icon name="lucide:scroll-text" /><span class="nav-label">Audit log</span></Link>
        </nav>
        <div class="sidebar-foot">
          <div class="profile">
            <span class="avatar" aria-hidden="true">{initials(me())}</span>
            <span class="profile-text">
              <strong>{me()?.name || me()?.email || "Signed in"}</strong>
              <span>{me()?.role ?? ""}</span>
            </span>
            <span class="profile-actions">
              <ThemeToggle />
              <a class="icon-button" href="/account" aria-label="Account settings" title="Account settings">
                <Icon name="lucide:settings" />
              </a>
              <button type="button" class="icon-button" aria-label="Sign out" title="Sign out" onClick={() => logout()}>
                <Icon name="lucide:log-out" />
              </button>
            </span>
          </div>
        </div>
      </aside>
      <div class="main">
        <header class="topbar">
          <button type="button" class="icon-button" aria-label="Open menu" aria-expanded={menu() ? "true" : "false"} onClick={() => setMenu(true)}>
            <Icon name="lucide:menu" />
          </button>
          <a class="brand" href="/" aria-label="Snapjaw dashboard">
            <LogoMark />
            <span>Snapjaw</span>
          </a>
          <ThemeToggle />
        </header>
        <main id="main" class="content" tabindex={-1}>
          {props.children}
        </main>
      </div>
    </div>
  );
}
