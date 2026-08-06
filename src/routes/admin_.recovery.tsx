import { Alert, Button, Form } from "@heroui/react";
import { createFileRoute } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";

import {
  AuthenticationField,
  AuthenticationSurface,
} from "../auth/auth-surface";
import { cloudflareWorkerSettingsHref } from "../auth/authentication-presentation";
import { m } from "../paraglide/messages.js";

export const Route = createFileRoute("/admin_/recovery")({
  component: Recover,
});

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
      title={state === "success" ? m.password_reset() : m.recovery()}
      description={
        state === "success" ? m.sessions_revoked() : m.recovery_description()
      }
      footerLink={{ href: "/admin/login", label: m.sign_in() }}
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
            <h1>{m.password_reset()}</h1>
            <p>{m.sessions_revoked()}</p>
          </div>
          <Alert status="warning" role="note" className="mt-4 mb-5">
            <Alert.Content>
              <Alert.Description>{m.rotate_secret()}</Alert.Description>
            </Alert.Content>
          </Alert>
          <Button
            fullWidth
            onPress={() => globalThis.location.assign("/admin/login")}
          >
            {m.continue_sign_in()}
          </Button>
        </div>
      ) : (
        <Form className="space-y-5" onSubmit={submit}>
          {state === "error" ? (
            <Alert status="danger" role="alert">
              <Alert.Content>
                <Alert.Title>{m.recovery_rejected()}</Alert.Title>
                <Alert.Description>
                  {m.recovery_rejected_description()}
                </Alert.Description>
              </Alert.Content>
            </Alert>
          ) : null}
          <AuthenticationField
            id="recoverySecret"
            label={m.recovery_secret()}
            type="password"
            autoComplete="off"
            placeholder={m.enter_recovery_secret()}
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
                  {m.set_code()}
                </a>
              ) : null
            }
          />
          <AuthenticationField
            id="newPassword"
            label={m.new_password()}
            type="password"
            autoComplete="new-password"
            minLength={12}
            maxLength={128}
            placeholder={
              state === "error" ? m.minimum_password_placeholder() : undefined
            }
            helperText={state === "ready" ? m.minimum_password() : undefined}
          />
          <Button fullWidth type="submit" isPending={state === "submitting"}>
            {m.reset_password()}
          </Button>
          <p className="text-center text-sm text-default-500">
            {m.remembered()}{" "}
            <a className="authentication-link font-medium" href="/admin/login">
              {m.back_to_sign_in()}
            </a>
          </p>
        </Form>
      )}
    </AuthenticationSurface>
  );
}
