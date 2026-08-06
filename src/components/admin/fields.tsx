import { Label } from "@heroui/react";
import type { ReactNode } from "react";

/** Labelled form field row matching the prototype's `.field` pattern. */
export function SettingsField({
  label,
  htmlFor,
  optional,
  description,
  issues = [],
  children,
}: Readonly<{
  label: string;
  htmlFor: string;
  optional?: string;
  description?: ReactNode;
  issues?: readonly string[];
  children: ReactNode;
}>) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-2)",
        width: "100%",
      }}
    >
      <Label
        htmlFor={htmlFor}
        style={{
          fontSize: "var(--text-small)",
          fontWeight: 550,
          display: "flex",
          alignItems: "baseline",
          gap: "var(--space-2)",
        }}
      >
        {label}
        {optional ? (
          <span
            style={{
              fontSize: "var(--text-tiny)",
              fontWeight: 400,
              color: "var(--foreground-faint)",
            }}
          >
            {optional}
          </span>
        ) : null}
      </Label>
      {children}
      {issues.length > 0 ? (
        <ul
          id={`${htmlFor}-error`}
          className="list-disc pl-5"
          role="alert"
          style={{
            color: "var(--danger)",
            fontSize: "var(--text-tiny)",
            margin: 0,
          }}
        >
          {issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      ) : null}
      {description ? (
        <p
          style={{
            fontSize: "var(--text-tiny)",
            color: "var(--foreground-muted)",
            margin: 0,
          }}
        >
          {description}
        </p>
      ) : null}
    </div>
  );
}
