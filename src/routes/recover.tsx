import { Alert, Button, Form } from "@heroui/react";
import { createFileRoute } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";

import {
  AuthenticationField,
  AuthenticationSurface,
} from "../auth/auth-surface";
import { cloudflareWorkerSettingsHref } from "../auth/authentication-presentation";

export const Route = createFileRoute("/recover")({ component: Recover });

type RecoveryState = "ready" | "submitting" | "success" | "error";

function Recover() {
  const [state, setState] = useState<RecoveryState>("ready");
  const cloudflareSettingsHref = cloudflareWorkerSettingsHref({
    appEnvironment: import.meta.env.PROD ? "production" : "local",
    workerName: import.meta.env.BRIEFLY_WORKER_NAME,
  });

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
      title={state === "success" ? "Password reset" : "Emergency recovery"}
      description={
        state === "success"
          ? "All existing sessions have been revoked — sign in again with the new password."
          : "Locked out? Reset the admin password with the Recovery Secret from your deployment environment."
      }
      footerLink={{ href: "/sign-in", label: "Sign in" }}
      showHeader={state !== "success"}
      showDescription={state === "ready"}
    >
      {state === "success" ? (
        <div>
          <div className="authentication-empty" role="status">
            <div className="authentication-empty-icon" aria-hidden="true">
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M20 6 9 17l-5-5" />
              </svg>
            </div>
            <h1>Password reset</h1>
            <p>
              All existing sessions have been revoked — sign in again with the
              new password.
            </p>
          </div>
          <Alert status="warning" role="note" className="mt-4 mb-5">
            <Alert.Content>
              <Alert.Description>
                Rotate or remove RECOVERY_SECRET from your environment as soon
                as possible — anyone holding it can reset this account.
              </Alert.Description>
            </Alert.Content>
          </Alert>
          <Button
            fullWidth
            onPress={() => globalThis.location.assign("/sign-in")}
          >
            Continue to sign in
          </Button>
        </div>
      ) : (
        <Form className="space-y-5" onSubmit={submit}>
          {state === "error" ? (
            <Alert status="danger" role="alert">
              <Alert.Content>
                <Alert.Title>Recovery Secret rejected</Alert.Title>
                <Alert.Description>
                  Check the value in your deployment environment. Nothing was
                  changed.
                </Alert.Description>
              </Alert.Content>
            </Alert>
          ) : null}
          <AuthenticationField
            id="recoverySecret"
            label="Recovery Secret"
            type="password"
            autoComplete="off"
            placeholder="Enter recovery secret"
            monospace
            invalid={state === "error"}
            labelEnd={
              state === "ready" && cloudflareSettingsHref ? (
                <a
                  className="authentication-link text-xs font-medium"
                  href={cloudflareSettingsHref}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Set code
                </a>
              ) : null
            }
          />
          <AuthenticationField
            id="newPassword"
            label="New password"
            type="password"
            autoComplete="new-password"
            minLength={12}
            maxLength={128}
            placeholder={
              state === "error" ? "Minimum 12 characters" : undefined
            }
            helperText={
              state === "ready" ? "Minimum 12 characters." : undefined
            }
          />
          <Button fullWidth type="submit" isPending={state === "submitting"}>
            Reset password
          </Button>
          <p className="text-center text-sm text-default-500">
            Remembered it?{" "}
            <a className="authentication-link font-medium" href="/sign-in">
              Back to sign in
            </a>
          </p>
        </Form>
      )}
    </AuthenticationSurface>
  );
}
