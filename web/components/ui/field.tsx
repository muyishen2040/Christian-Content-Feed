"use client";

import { useId, type InputHTMLAttributes } from "react";

type TextFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "size"> & {
  label: string;
  hint?: string;
  error?: string;
};

export function TextField({
  label,
  hint,
  error,
  id,
  className,
  "aria-describedby": describedBy,
  ...props
}: TextFieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const descriptionIds = [
    hint ? `${inputId}-hint` : null,
    error ? `${inputId}-error` : null,
    describedBy,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="ui-field">
      <label className="ui-field-label" htmlFor={inputId}>
        {label}
      </label>
      <input
        {...props}
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={descriptionIds || undefined}
        className={["ui-input", className].filter(Boolean).join(" ")}
      />
      {hint ? (
        <p className="ui-field-hint" id={`${inputId}-hint`}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p className="ui-field-error" id={`${inputId}-error`} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
