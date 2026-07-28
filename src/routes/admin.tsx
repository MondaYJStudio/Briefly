import { Alert, Button } from "@heroui/react";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { AuthenticationSurface } from "../auth/auth-surface";

export const Route = createFileRoute("/admin")({ component: Admin });

function Admin() {
  const [state, setState] = useState<"ready" | "submitting" | "error">("ready");

  async function signOut() {
    setState("submitting");
    try {
      const response = await fetch("/api/auth/sign-out", { method: "POST" });
      if (response.ok) {
        globalThis.location.replace("/sign-in");
      } else {
        setState("error");
      }
    } catch {
      setState("error");
    }
  }

  return (
    <AuthenticationSurface
      title="Administrator session"
      description="This route is guarded for navigation convenience. Every administration operation still checks the server-side session."
    >
      {state === "error" ? (
        <Alert status="danger" role="alert">
          <Alert.Content>
            <Alert.Title>Unable to sign out</Alert.Title>
            <Alert.Description>Please try again.</Alert.Description>
          </Alert.Content>
        </Alert>
      ) : null}
      <Button fullWidth isPending={state === "submitting"} onPress={signOut}>
        Sign out
      </Button>
    </AuthenticationSurface>
  );
}
