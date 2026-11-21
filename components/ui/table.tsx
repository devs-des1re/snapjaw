export function Table(props: { label: string; children?: unknown }) {
  return (
    <div class="table-wrap" role="region" aria-label={props.label} tabindex={0}>
      <table class="table">{props.children}</table>
    </div>
  );
}

export function Empty(props: { title: string; hidden?: boolean; children?: unknown }) {
  return (
    <div class="empty" hidden={props.hidden}>
      <strong>{props.title}</strong>
      <span>{props.children}</span>
    </div>
  );
}
