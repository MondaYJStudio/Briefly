import type { ReactNode } from "react";

import { AdminIcon, type AdminIconName } from "./icons";
import styles from "./status-chip.module.css";

type StatusChipVariant =
  "default" | "primary" | "success" | "warning" | "danger";

const variantClass: Record<StatusChipVariant, string> = {
  default: styles.chipDefault,
  primary: styles.chipPrimary,
  success: styles.chipSuccess,
  warning: styles.chipWarning,
  danger: styles.chipDanger,
};

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
    <span
      className={`${styles.chip} inline-flex items-center text-xs gap-2 py-0 px-2 ${variantClass[variant]}`}
    >
      {dot ? <span className={styles.dot} aria-hidden="true" /> : null}
      {icon ? <AdminIcon name={icon} size={12} strokeWidth={2.2} /> : null}
      {children}
    </span>
  );
}
