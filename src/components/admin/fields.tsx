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
    <div className={`flex w-full flex-col gap-2`}>
      <Label
        htmlFor={htmlFor}
        className={`${styles.label} text-sm flex items-baseline gap-2`}
      >
        {label}
        {optional ? (
          <span className={`${styles.optional} text-xs`}>{optional}</span>
        ) : null}
      </Label>
      {children}
      {issues.length > 0 ? (
        <ul
          id={`${htmlFor}-error`}
          className={`${styles.issues} list-disc text-xs pl-5 m-0`}
          role="alert"
        >
          {issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      ) : null}
      {description ? (
        <p className={`${styles.description} text-xs m-0`}>{description}</p>
      ) : null}
    </div>
  );
}
