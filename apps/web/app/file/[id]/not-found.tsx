import Link from "next/link";

export default function SharedFileNotFound() {
  return (
    <main className="flex h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
      <h1 className="text-base font-semibold text-fg">That file is not here</h1>
      <p className="max-w-md text-sm text-fg-muted">
        The link may be mistyped, or the file may have been removed.
      </p>
      <Link
        href="/"
        className="mt-1 rounded-md text-sm text-fg underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      >
        Start a new file
      </Link>
    </main>
  );
}
