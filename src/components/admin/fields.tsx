import { Label } from "@heroui/react";
import type { ReactNode } from "react";

import styles from "./fields.module.css";

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
    <div className={styles.field}>
      <Label htmlFor={htmlFor} className={styles.label}>
        {label}
        {optional ? <span className={styles.optional}>{optional}</span> : null}
      </Label>
      {children}
      {issues.length > 0 ? (
        <ul id={`${htmlFor}-error`} className={styles.issues} role="alert">
          {issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      ) : null}
      {description ? <p className={styles.description}>{description}</p> : null}
    </div>
  );
}
