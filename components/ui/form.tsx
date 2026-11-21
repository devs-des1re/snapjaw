export function Field(props: { label: string; for: string; hint?: string; error?: string; children?: unknown }) {
  return (
    <div class="field">
      <label for={props.for}>{props.label}</label>
      {props.children}
      <span class="field-hint" id={`${props.for}-hint`} hidden={!(Boolean(props.hint))}>
        {props.hint}
      </span>
      <span class="field-error" role="alert" hidden={!(Boolean(props.error))}>
        {props.error}
      </span>
    </div>
  );
}

export function Notice(props: { tone?: "bad" | "warn" | "good" | "info"; title?: string; hidden?: boolean; children?: unknown }) {
  return (
    <div class="notice" hidden={props.hidden} data-tone={props.tone ?? "info"} role={props.tone === "bad" ? "alert" : "status"}>
      <div class="notice-body">
        <strong hidden={!(Boolean(props.title))}>{props.title}</strong>
        <span>{props.children}</span>
      </div>
    </div>
  );
}
