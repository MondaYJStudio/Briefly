import { Alert, Button, Form } from "@heroui/react";
import { createFileRoute } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";

import {
  AuthenticationField,
  AuthenticationSurface,
} from "../auth/auth-surface";

export const Route = createFileRoute("/sign-in")({ component: SignIn });

function SignIn() {
  const [state, setState] = useState<
    "ready" | "submitting" | "error" | "offline"
  >("ready");

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
      title="Sign in"
      description="The single administrator signs in here. Readers never see this page."
      footerLink={{ href: "/setup", label: "First-run setup" }}
    >
      <Form className="space-y-5" onSubmit={submit}>
        {state === "error" ? (
          <Alert status="danger" role="alert">
            <Alert.Content>
              <Alert.Title>Incorrect email or password</Alert.Title>
              <Alert.Description>
                Try again. This message stays the same whether the email exists
                or not.
              </Alert.Description>
            </Alert.Content>
          </Alert>
        ) : state === "offline" ? (
          <Alert status="warning" role="alert">
            <Alert.Content>
              <Alert.Title>You appear to be offline</Alert.Title>
              <Alert.Description>
                Signing in needs a connection to your Briefly server. Your input
                is kept.
              </Alert.Description>
            </Alert.Content>
          </Alert>
        ) : null}
        <AuthenticationField
          id="email"
          label="Email"
          type="email"
          autoComplete="username"
          placeholder="you@example.com"
        />
        <AuthenticationField
          id="password"
          label="Password"
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
          Sign in
        </Button>
        <p className="text-center text-sm text-default-500">
          Lost access?{" "}
          <a className="authentication-link font-medium" href="/recover">
            Emergency recovery
          </a>
        </p>
      </Form>
    </AuthenticationSurface>
  );
}
