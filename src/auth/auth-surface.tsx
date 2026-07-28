import { Input, Label, Surface } from "@heroui/react";
import type { ReactNode } from "react";

export function AuthenticationSurface({
  title,
  description,
  children,
}: Readonly<{
  title: string;
  description: string;
  children: ReactNode;
}>) {
  return (
    <main className="mx-auto flex min-h-screen max-w-lg items-center px-6 py-16">
      <Surface className="w-full space-y-6 rounded-2xl p-8" variant="secondary">
        <header className="space-y-2">
          <p className="text-sm font-medium tracking-wide text-default-500 uppercase">
            Briefly administration
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
          <p className="text-default-600">{description}</p>
        </header>
        {children}
      </Surface>
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
}: Readonly<{
  id: string;
  label: string;
  type: "email" | "password" | "text";
  autoComplete: string;
  minLength?: number;
  maxLength?: number;
}>) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        fullWidth
        id={id}
        name={id}
        type={type}
        autoComplete={autoComplete}
        minLength={minLength}
        maxLength={maxLength}
        required
      />
    </div>
  );
}
