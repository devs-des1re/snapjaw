import { createSignal } from "@krate/runtime";

export function CopyButton(props: { text: string; label?: string }) {
  const [copied, setCopied] = createSignal(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(props.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }
  return (
    <button
      type="button"
      class="copy"
      data-copied={copied() ? "true" : "false"}
      aria-label={copied() ? "Copied" : props.label ?? "Copy to clipboard"}
      title={copied() ? "Copied" : props.label ?? "Copy"}
      onClick={() => copy()}
    >
      <span class="icon-slot" hidden={!(!copied())}><Icon name="lucide:copy" /></span>
      <span class="icon-slot" hidden={!(copied())}><Icon name="lucide:check" /></span>
    </button>
  );
}

export function Value(props: { text: string; mono?: boolean }) {
  return (
    <span class="value">
      <code title={props.text}>{props.text}</code>
      <CopyButton text={props.text} />
    </span>
  );
}

export function ValueBlock(props: { text: string; label?: string }) {
  return (
    <div class="value-block">
      <code>{props.text}</code>
      <CopyButton text={props.text} label={props.label} />
    </div>
  );
}
