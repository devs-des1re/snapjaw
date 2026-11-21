export function PageHeader(props: { title: string; description?: string; children?: unknown }) {
  return (
    <header class="page-header">
      <div>
        <h1>{props.title}</h1>
        <p hidden={!(Boolean(props.description))}>{props.description}</p>
      </div>
      <div class="page-actions">{props.children}</div>
    </header>
  );
}

export function Section(props: { title: string; description?: string; actions?: unknown; hidden?: boolean; children?: unknown }) {
  return (
    <section class="section" hidden={props.hidden}>
      <div class="section-head">
        <div>
          <h2>{props.title}</h2>
          <p hidden={!(Boolean(props.description))}>{props.description}</p>
        </div>
        <div class="page-actions">{props.actions}</div>
      </div>
      {props.children}
    </section>
  );
}
