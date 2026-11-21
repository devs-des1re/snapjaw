import { AppShell } from "../../../components/blocks/app-shell";

export default function AppLayout({ children }: { children?: unknown }) {
  return <AppShell>{children}</AppShell>;
}
