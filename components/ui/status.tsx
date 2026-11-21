export type Tone = "good" | "wait" | "bad" | "neutral" | "muted";

const tones: Record<string, Tone> = {
  delivered: "good",
  sent: "good",
  verified: "good",
  ok: "good",
  done: "good",
  active: "good",
  enabled: "good",
  accepted: "wait",
  queued: "wait",
  pending: "wait",
  in_flight: "wait",
  running: "wait",
  not_started: "wait",
  partially_verified: "wait",
  delivery_delayed: "wait",
  held: "wait",
  temporary_failure: "wait",
  unknown: "muted",
  skipped: "muted",
  disabled: "muted",
  revoked: "muted",
  bounced: "bad",
  complained: "bad",
  failed: "bad",
  dead: "bad",
  rejected: "bad",
  failing: "bad",
  partially_failed: "bad",
  suppressed: "bad",
};

export function toneFor(status: string | null | undefined): Tone {
  return tones[status ?? ""] ?? "neutral";
}

export function label(status: string | null | undefined): string {
  return (status ?? "unknown").replace(/_/g, " ");
}

export function Status(props: { value: string | null | undefined; tone?: Tone }) {
  return (
    <span class="status" data-tone={props.tone ?? toneFor(props.value)}>
      {label(props.value)}
    </span>
  );
}
