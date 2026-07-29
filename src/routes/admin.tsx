import { Alert, Button, Form } from "@heroui/react";
import { createFileRoute } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";

import {
  AuthenticationField,
  AuthenticationSurface,
} from "../auth/auth-surface";

export const Route = createFileRoute("/admin")({ component: Admin });

function Admin() {
  const [signOutState, setSignOutState] = useState<
    "ready" | "submitting" | "error"
  >("ready");
  const [passwordState, setPasswordState] = useState<
    "ready" | "submitting" | "error"
  >("ready");

  async function signOut() {
    setSignOutState("submitting");
    try {
      const response = await fetch("/api/auth/sign-out", { method: "POST" });
      if (response.ok) {
        globalThis.location.replace("/sign-in");
      } else {
        setSignOutState("error");
      }
    } catch {
      setSignOutState("error");
    }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPasswordState("submitting");
    const formData = new FormData(event.currentTarget);

    try {
      const response = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          currentPassword: formData.get("currentPassword"),
          newPassword: formData.get("newPassword"),
        }),
      });
      if (response.ok) {
        globalThis.location.replace("/sign-in");
      } else {
        setPasswordState("error");
      }
    } catch {
      setPasswordState("error");
    }
  }

  return (
    <AuthenticationSurface
      title="Administrator session"
      description="This route is guarded for navigation convenience. Every administration operation still checks the server-side session."
    >
      {signOutState === "error" ? (
        <Alert status="danger" role="alert">
          <Alert.Content>
            <Alert.Title>Unable to sign out</Alert.Title>
            <Alert.Description>Please try again.</Alert.Description>
          </Alert.Content>
        </Alert>
      ) : null}
      <Form className="space-y-5" onSubmit={changePassword}>
        <h2 className="text-xl font-semibold">Change password</h2>
        {passwordState === "error" ? (
          <Alert status="danger" role="alert">
            <Alert.Content>
              <Alert.Title>Unable to change password</Alert.Title>
              <Alert.Description>
                Check the current password and new password, then try again.
              </Alert.Description>
            </Alert.Content>
          </Alert>
        ) : null}
        <AuthenticationField
          id="currentPassword"
          label="Current password"
          type="password"
          autoComplete="current-password"
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
          Changing the password revokes every Administrator session, including
          this one, and requires a fresh sign-in.
        </p>
        <Button
          fullWidth
          type="submit"
          isPending={passwordState === "submitting"}
        >
          Change password and revoke sessions
        </Button>
      </Form>
      <Button
        fullWidth
        variant="secondary"
        isPending={signOutState === "submitting"}
        onPress={signOut}
      >
        Sign out
      </Button>
    </AuthenticationSurface>
  );
}
