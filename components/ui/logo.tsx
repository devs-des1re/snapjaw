export function LogoMark() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
      <path d="M1 1h14v7h-3V4H1z" />
      <path d="M15 15H1V8h3v4h11z" />
    </svg>
  );
}

export function Wordmark(props: { href?: string }) {
  return (
    <a class="brand" href={props.href ?? "/"} aria-label="Snapjaw home">
      <LogoMark />
      <span class="brand-name">Snapjaw</span>
    </a>
  );
}
