import { Alert, Button, Form, Spinner } from "@heroui/react";
import { createFileRoute } from "@tanstack/react-router";
import { type FormEvent, useEffect, useState } from "react";

import {
  AuthenticationField,
  AuthenticationSurface,
} from "../auth/auth-surface";
import authStyles from "../auth/auth-surface.module.css";
import { cloudflareWorkerSettingsHref } from "../auth/authentication-presentation";
import { m } from "../paraglide/messages.js";

export const Route = createFileRoute("/admin_/setup")({ component: Setup });

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
          globalThis.location.replace("/admin/login");
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
      title={state === "success" ? m.briefly_ready() : m.setup()}
      description={
        state === "success" ? m.setup_success() : m.setup_description()
      }
      footerLink={{ href: "/admin/login", label: m.sign_in() }}
      showHeader={state !== "success"}
    >
      {state === "checking" ? (
        <div className="flex items-center gap-3" role="status">
          <Spinner aria-label={m.setup_checking_label()} />
          <span>{m.setup_checking()}</span>
        </div>
      ) : state === "success" ? (
        <div className={`${authStyles.empty} grid text-center`} role="status">
          <div
            className={`${authStyles.emptyIcon} grid place-items-center mb-4`}
            aria-hidden="true"
          >
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
          <h1>{m.briefly_ready()}</h1>
          <p>{m.setup_success()}</p>
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
                <Alert.Title>{m.setup_failed()}</Alert.Title>
                <Alert.Description>
                  {m.setup_failed_description()}
                </Alert.Description>
              </Alert.Content>
            </Alert>
          ) : null}
          <AuthenticationField
            id="setupSecret"
            label={m.setup_code()}
            type="password"
            autoComplete="off"
            placeholder={m.enter_setup_code()}
            monospace
            labelEnd={
              cloudflareSettingsHref ? (
                <a
                  className={`${authStyles.link} text-xs font-medium`}
                  href={cloudflareSettingsHref}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {m.get_code()}
                </a>
              ) : null
            }
          />
          <AuthenticationField
            id="email"
            label={m.admin_email()}
            type="email"
            autoComplete="username"
            placeholder="you@example.com"
          />
          <AuthenticationField
            id="password"
            label={m.password()}
            type="password"
            autoComplete="new-password"
            minLength={12}
            maxLength={128}
            helperText={m.minimum_password()}
          />
          <Button fullWidth type="submit" isPending={state === "submitting"}>
            {m.initialize()}
          </Button>
        </Form>
      )}
    </AuthenticationSurface>
  );
}
