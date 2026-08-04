import type { ReactNode } from "react";

import { AdminIcon, type AdminIconName } from "./icons";

type StatusChipVariant =
  "default" | "primary" | "success" | "warning" | "danger";

export function StatusChip({
  variant = "default",
  icon,
  dot = false,
  children,
}: Readonly<{
  variant?: StatusChipVariant;
  icon?: AdminIconName;
  dot?: boolean;
  children: ReactNode;
}>) {
  return (
    <span className={`chip chip-${variant}`}>
      {dot ? <span className="dot" aria-hidden="true" /> : null}
      {icon ? <AdminIcon name={icon} size={12} strokeWidth={2.2} /> : null}
      {children}
    </span>
  );
}
