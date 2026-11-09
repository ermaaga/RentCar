import type { SelectHTMLAttributes } from "react";

// Labelled native select (keyboard and screen-reader behaviour of the platform, 48 px target).
interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  name: string;
  label: string;
  options: readonly { value: string; label: string }[];
  error?: string | undefined;
}

export function SelectField({ name, label, options, error, ...select }: SelectFieldProps) {
  const errorId = error ? `${name}-error` : undefined;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={name} className="font-medium">
        {label}
      </label>
      <select
        id={name}
        name={name}
        aria-invalid={error ? true : undefined}
        aria-describedby={errorId}
        className="min-h-12 rounded-md border border-border bg-background px-3 text-foreground"
        {...select}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {error ? (
        <p id={errorId} className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
