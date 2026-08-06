import { Alert, Button, Form, Spinner } from "@heroui/react";
import { createFileRoute } from "@tanstack/react-router";
import { type FormEvent, useEffect, useState } from "react";

import {
  AuthenticationField,
  AuthenticationSurface,
} from "../auth/auth-surface";
import { cloudflareWorkerSettingsHref } from "../auth/authentication-presentation";

export const Route = createFileRoute("/setup")({ component: Setup });

type SetupState = "checking" | "ready" | "submitting" | "success" | "error";

function Setup() {
  const [state, setState] = useState<SetupState>("checking");
  const cloudflareSettingsHref = cloudflareWorkerSettingsHref({
    appEnvironment: import.meta.env.PROD ? "production" : "local",
    workerName: import.meta.env.BRIEFLY_WORKER_NAME,
  });

  useEffect(() => {
    let active = true;
    void fetch("/api/installation", { headers: { accept: "application/json" } })
      .then(async (response) => {
        if (!response.ok) throw new Error("Installation status unavailable");
        const result = (await response.json()) as { initialized: boolean };
        if (!active) return;
        if (result.initialized) {
          globalThis.location.replace("/sign-in");
        } else {
          setState("ready");
        }
      })
      .catch(() => {
        if (active) setState("error");
      });
    return () => {
      active = false;
    };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("submitting");
    const formData = new FormData(event.currentTarget);

    try {
      const response = await fetch("/api/initialize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          setupSecret: formData.get("setupSecret"),
          email: formData.get("email"),
          password: formData.get("password"),
        }),
      });
      setState(response.status === 201 ? "success" : "error");
    } catch {
      setState("error");
    }
  }

  return (
    <AuthenticationSurface
      title={state === "success" ? "Briefly is ready" : "First-run setup"}
      description={
        state === "success"
          ? "The admin account was created. The one-time setup code is now permanently disabled."
          : "Create the single administrator for this site."
      }
      footerLink={{ href: "/sign-in", label: "Sign in" }}
      showHeader={state !== "success"}
    >
      {state === "checking" ? (
        <div className="flex items-center gap-3" role="status">
          <Spinner aria-label="Checking installation status" />
          <span>Checking installation status…</span>
        </div>
      ) : state === "success" ? (
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
          <h1>Briefly is ready</h1>
          <p>
            The admin account was created. The one-time setup code is now
            permanently disabled.
          </p>
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
                <Alert.Title>Initialization failed</Alert.Title>
                <Alert.Description>
                  Check the supplied values or try again later.
                </Alert.Description>
              </Alert.Content>
            </Alert>
          ) : null}
          <AuthenticationField
            id="setupSecret"
            label="Setup code"
            type="password"
            autoComplete="off"
            placeholder="Enter setup code"
            monospace
            labelEnd={
              cloudflareSettingsHref ? (
                <a
                  className="authentication-link text-xs font-medium"
                  href={cloudflareSettingsHref}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Get code
                </a>
              ) : null
            }
          />
          <AuthenticationField
            id="email"
            label="Admin email"
            type="email"
            autoComplete="username"
            placeholder="you@example.com"
          />
          <AuthenticationField
            id="password"
            label="Password"
            type="password"
            autoComplete="new-password"
            minLength={12}
            maxLength={128}
            helperText="Minimum 12 characters. This signs in the only admin account."
          />
          <Button fullWidth type="submit" isPending={state === "submitting"}>
            Initialize Briefly
          </Button>
        </Form>
      )}
    </AuthenticationSurface>
  );
}
