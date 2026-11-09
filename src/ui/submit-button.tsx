"use client";

import { useFormStatus } from "react-dom";

/** Primary submit button that shows a pending label and prevents double submits. */
export function SubmitButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-disabled={pending}
      className="min-h-12 rounded-md bg-primary px-4 font-semibold text-primary-foreground disabled:opacity-70"
    >
      {pending ? pendingLabel : label}
    </button>
  );
}
