export type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive";
export type ButtonSize = "sm" | "md" | "lg";

export function RowButton(props: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  hidden?: boolean;
  label?: string;
  onClick?: (event: MouseEvent) => void;
  children?: unknown;
}) {
  return (
    <button
      type="button"
      class={`krate-button krate-button-${props.variant ?? "ghost"} krate-button-${props.size ?? "sm"}`}
      hidden={props.hidden}
      aria-label={props.label}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}
