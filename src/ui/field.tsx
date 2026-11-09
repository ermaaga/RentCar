import type { InputHTMLAttributes } from "react";

// Labelled input with an optional hint and error, wired with aria-describedby (WCAG 1.3.1, 3.3.1).
interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  name: string;
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
}

export function Field({ name, label, hint, error, id, ...input }: FieldProps) {
  // `id` defaults to `name`; pass one when the same field repeats on a page (one form per row).
  const fieldId = id ?? name;
  const hintId = hint ? `${fieldId}-hint` : undefined;
  const errorId = error ? `${fieldId}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={fieldId} className="font-medium">
        {label}
      </label>
      {hint ? (
        <p id={hintId} className="text-sm text-muted-foreground">
          {hint}
        </p>
      ) : null}
      <input
        id={fieldId}
        name={name}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className="min-h-12 rounded-md border border-border bg-background px-3 text-foreground"
        {...input}
      />
      {error ? (
        <p id={errorId} className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
