import { Input, Label, Surface } from "@heroui/react";
import type { ReactNode } from "react";

export function AuthenticationSurface({
  title,
  description,
  children,
  footerLink,
}: Readonly<{
  title: string;
  description: string;
  children: ReactNode;
  footerLink: Readonly<{ href: string; label: string }>;
}>) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-6">
      <div className="mb-6 flex items-center justify-center gap-2 text-lg font-semibold tracking-tight">
        <span
          aria-hidden="true"
          className="grid size-8 place-items-center rounded-lg bg-foreground font-serif text-[1.1rem] font-bold text-background"
        >
          B
        </span>
        <span>Briefly</span>
      </div>
      <Surface
        className="w-full max-w-[23rem] space-y-5 rounded-[0.875rem] border border-default-200 p-6 shadow-sm"
        variant="secondary"
      >
        <header>
          <h1 className="text-[1.375rem] font-bold tracking-[-0.015em]">
            {title}
          </h1>
          <p className="mt-2 text-sm text-default-600">{description}</p>
        </header>
        {children}
      </Surface>
      <p className="mt-5 text-center text-xs text-default-500">
        Briefly ·{" "}
        <a className="authentication-link font-medium" href={footerLink.href}>
          {footerLink.label}
        </a>
      </p>
    </main>
  );
}

export function AuthenticationField({
  id,
  label,
  type,
  autoComplete,
  minLength,
  maxLength,
  placeholder,
  helperText,
  labelEnd,
  monospace = false,
}: Readonly<{
  id: string;
  label: string;
  type: "email" | "password" | "text";
  autoComplete: string;
  minLength?: number;
  maxLength?: number;
  placeholder?: string;
  helperText?: string;
  labelEnd?: ReactNode;
  monospace?: boolean;
}>) {
  const helperId = helperText ? `${id}-hint` : undefined;

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <Label htmlFor={id}>{label}</Label>
        {labelEnd}
      </div>
      <Input
        fullWidth
        id={id}
        name={id}
        type={type}
        autoComplete={autoComplete}
        minLength={minLength}
        maxLength={maxLength}
        placeholder={placeholder}
        aria-describedby={helperId}
        className={monospace ? "font-mono" : undefined}
        required
      />
      {helperText ? (
        <p className="text-xs text-default-500" id={helperId}>
          {helperText}
        </p>
      ) : null}
    </div>
  );
}
