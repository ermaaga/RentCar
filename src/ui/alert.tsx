import type { ReactNode } from "react";

/** Error or status message announced to screen readers. */
export function Alert({ kind, children }: { kind: "error" | "status"; children: ReactNode }) {
  return kind === "error" ? (
    <p role="alert" className="rounded-md border border-danger px-3 py-2 text-danger">
      {children}
    </p>
  ) : (
    <p role="status" className="rounded-md border border-border px-3 py-2">
      {children}
    </p>
  );
}
