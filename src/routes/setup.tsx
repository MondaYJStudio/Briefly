import { Alert, Button, Form, Spinner } from "@heroui/react";
import { createFileRoute } from "@tanstack/react-router";
import { type FormEvent, useEffect, useState } from "react";

import {
  AuthenticationField,
  AuthenticationSurface,
} from "../auth/auth-surface";

export const Route = createFileRoute("/setup")({ component: Setup });

type SetupState = "checking" | "ready" | "submitting" | "success" | "error";

function Setup() {
  const [state, setState] = useState<SetupState>("checking");

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
      title="Initialize Briefly"
      description="Claim this fresh installation with the setup secret configured by the deployment operator. This can be done only once."
    >
      {state === "checking" ? (
        <div className="flex items-center gap-3" role="status">
          <Spinner aria-label="Checking installation status" />
          <span>Checking installation status…</span>
        </div>
      ) : state === "success" ? (
        <div className="space-y-4">
          <Alert status="success">
            <Alert.Content>
              <Alert.Title>Initialization complete</Alert.Title>
              <Alert.Description>
                The sole Administrator can now sign in.
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
                <Alert.Title>Initialization failed</Alert.Title>
                <Alert.Description>
                  Check the supplied values or try again later.
                </Alert.Description>
              </Alert.Content>
            </Alert>
          ) : null}
          <AuthenticationField
            id="setupSecret"
            label="Setup secret"
            type="password"
            autoComplete="off"
          />
          <AuthenticationField
            id="email"
            label="Administrator email"
            type="email"
            autoComplete="username"
          />
          <AuthenticationField
            id="password"
            label="Password"
            type="password"
            autoComplete="new-password"
            minLength={12}
            maxLength={128}
          />
          <p className="text-sm text-default-500">
            Use at least 12 characters. A password manager-generated password is
            recommended.
          </p>
          <Button fullWidth type="submit" isPending={state === "submitting"}>
            Initialize
          </Button>
        </Form>
      )}
    </AuthenticationSurface>
  );
}
