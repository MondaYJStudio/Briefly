import { Alert, Button, Form } from "@heroui/react";
import { createFileRoute } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";

import {
  AuthenticationField,
  AuthenticationSurface,
} from "../auth/auth-surface";

export const Route = createFileRoute("/recover")({ component: Recover });

type RecoveryState = "ready" | "submitting" | "success" | "error";

function Recover() {
  const [state, setState] = useState<RecoveryState>("ready");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("submitting");
    const formData = new FormData(event.currentTarget);

    try {
      const response = await fetch("/api/recover", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          recoverySecret: formData.get("recoverySecret"),
          newPassword: formData.get("newPassword"),
        }),
      });
      setState(response.ok ? "success" : "error");
    } catch {
      setState("error");
    }
  }

  return (
    <AuthenticationSurface
      title="Recover Administrator"
      description="This emergency reset replaces the existing Administrator password and revokes every Administrator session. A fresh sign-in is required."
    >
      {state === "success" ? (
        <div className="space-y-4">
          <Alert status="success">
            <Alert.Content>
              <Alert.Title>Recovery complete</Alert.Title>
              <Alert.Description>
                Sign in with the new password, then remove or rotate the
                temporary recovery secret immediately.
              </Alert.Description>
            </Alert.Content>
          </Alert>
          <Button onPress={() => globalThis.location.assign("/sign-in")}>
            Continue to sign in
          </Button>
        </div>
      ) : (
        <Form className="space-y-5" onSubmit={submit}>
          {state === "error" ? (
            <Alert status="danger" role="alert">
              <Alert.Content>
                <Alert.Title>Recovery failed</Alert.Title>
                <Alert.Description>
                  The request was not accepted. Check the supplied values or try
                  again later.
                </Alert.Description>
              </Alert.Content>
            </Alert>
          ) : null}
          <AuthenticationField
            id="recoverySecret"
            label="Temporary recovery secret"
            type="password"
            autoComplete="off"
          />
          <AuthenticationField
            id="newPassword"
            label="New password"
            type="password"
            autoComplete="new-password"
            minLength={12}
            maxLength={128}
          />
          <p className="text-sm text-default-500">
            Use at least 12 characters. Success signs out every existing
            Administrator session, including sessions on other devices.
          </p>
          <Button fullWidth type="submit" isPending={state === "submitting"}>
            Reset password and revoke sessions
          </Button>
        </Form>
      )}
    </AuthenticationSurface>
  );
}
