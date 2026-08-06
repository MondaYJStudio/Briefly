import { Alert, Button, Form } from "@heroui/react";
import { createFileRoute } from "@tanstack/react-router";
import { type FormEvent, useEffect, useState } from "react";

import {
  AuthenticationField,
  AuthenticationSurface,
} from "../auth/auth-surface";
import { m } from "../paraglide/messages.js";

export const Route = createFileRoute("/admin_/login")({ component: SignIn });

function SignIn() {
  const [state, setState] = useState<
    "ready" | "submitting" | "error" | "offline"
  >("ready");
  const [setupAvailable, setSetupAvailable] = useState(false);

  useEffect(() => {
    let active = true;
    void fetch("/api/installation", {
      headers: { accept: "application/json" },
    })
      .then(async (response) => {
        if (!response.ok) return;
        const result = (await response.json()) as { initialized: boolean };
        if (active) setSetupAvailable(!result.initialized);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("submitting");
    const formData = new FormData(event.currentTarget);

    try {
      const response = await fetch("/api/auth/sign-in/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: formData.get("email"),
          password: formData.get("password"),
        }),
      });
      if (response.ok) {
        globalThis.location.replace("/admin");
      } else {
        setState("error");
      }
    } catch {
      setState("offline");
    }
  }

  return (
    <AuthenticationSurface
      title={m.sign_in()}
      description={m.admin_description()}
      footerLink={
        setupAvailable ? { href: "/admin/setup", label: m.setup() } : undefined
      }
    >
      <Form className="space-y-5" onSubmit={submit}>
        {state === "error" ? (
          <Alert status="danger" role="alert">
            <Alert.Content>
              <Alert.Title>{m.incorrect_credentials()}</Alert.Title>
              <Alert.Description>{m.generic_credentials()}</Alert.Description>
            </Alert.Content>
          </Alert>
        ) : state === "offline" ? (
          <Alert status="warning" role="alert">
            <Alert.Content>
              <Alert.Title>{m.offline()}</Alert.Title>
              <Alert.Description>{m.offline_description()}</Alert.Description>
            </Alert.Content>
          </Alert>
        ) : null}
        <AuthenticationField
          id="email"
          label={m.email()}
          type="email"
          autoComplete="username"
          placeholder="you@example.com"
        />
        <AuthenticationField
          id="password"
          label={m.password()}
          type="password"
          autoComplete="current-password"
          minLength={12}
          maxLength={128}
          placeholder="••••••••••••"
        />
        <Button
          fullWidth
          type="submit"
          isPending={state === "submitting"}
          isDisabled={state === "offline"}
        >
          {m.sign_in()}
        </Button>
        <p className="text-center text-sm text-default-500">
          {m.lost_access()}{" "}
          <a className="authentication-link font-medium" href="/admin/recovery">
            {m.recovery_link()}
          </a>
        </p>
      </Form>
    </AuthenticationSurface>
  );
}
