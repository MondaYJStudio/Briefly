import { Alert, Button } from "@heroui/react";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { AuthenticationSurface } from "../auth/auth-surface";
import type { OAuthClientSummary } from "../auth/connected-apps";
import { m } from "../paraglide/messages.js";

/**
 * The consent page every MCP authorization passes through.
 *
 * It is the security boundary for agent access: the Worker forces
 * `prompt=consent`, so a signed-in Administrator who opens an authorization
 * URL lands here instead of handing a code to whoever registered the client.
 * The copy names what the client may do and where the code goes.
 */
export const Route = createFileRoute("/admin_/oauth/consent")({
  validateSearch: (search: Record<string, unknown>) => ({
    consent_code:
      typeof search.consent_code === "string" ? search.consent_code : "",
    client_id: typeof search.client_id === "string" ? search.client_id : "",
  }),
  component: OAuthConsent,
});

type ConsentState =
  | { kind: "loading" }
  | { kind: "invalid" }
  | { kind: "ready"; client: OAuthClientSummary }
  | { kind: "submitting"; client: OAuthClientSummary; accept: boolean }
  | { kind: "failed"; client: OAuthClientSummary };

function OAuthConsent() {
  const { consent_code: consentCode, client_id: clientId } = Route.useSearch();
  const [state, setState] = useState<ConsentState>({ kind: "loading" });

  useEffect(() => {
    if (!consentCode || !clientId) {
      setState({ kind: "invalid" });
      return;
    }
    let active = true;
    void fetch(`/api/admin/oauth-clients/${encodeURIComponent(clientId)}`, {
      headers: { accept: "application/json" },
    })
      .then(async (response) => {
        if (!active) return;
        if (!response.ok) {
          setState({ kind: "invalid" });
          return;
        }
        setState({
          kind: "ready",
          client: (await response.json()) as OAuthClientSummary,
        });
      })
      .catch(() => {
        if (active) setState({ kind: "invalid" });
      });
    return () => {
      active = false;
    };
  }, [consentCode, clientId]);

  async function answer(client: OAuthClientSummary, accept: boolean) {
    setState({ kind: "submitting", client, accept });
    try {
      const response = await fetch("/api/auth/oauth2/consent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accept, consent_code: consentCode }),
      });
      if (!response.ok) {
        setState({ kind: "failed", client });
        return;
      }
      const { redirectURI } = (await response.json()) as {
        redirectURI: string;
      };
      globalThis.location.assign(redirectURI);
    } catch {
      setState({ kind: "failed", client });
    }
  }

  if (state.kind === "loading") {
    return (
      <AuthenticationSurface
        title={m.oauth_consent_heading()}
        description={m.oauth_consent_description()}
        showDescription={false}
      >
        <p className="text-sm text-default-500" role="status">
          {m.oauth_consent_loading()}
        </p>
      </AuthenticationSurface>
    );
  }

  if (state.kind === "invalid") {
    return (
      <AuthenticationSurface
        title={m.oauth_consent_heading()}
        description={m.oauth_consent_description()}
        showDescription={false}
      >
        <Alert status="danger" role="alert">
          <Alert.Content>
            <Alert.Title>{m.oauth_consent_invalid()}</Alert.Title>
            <Alert.Description>
              {m.oauth_consent_invalid_description()}
            </Alert.Description>
          </Alert.Content>
        </Alert>
      </AuthenticationSurface>
    );
  }

  const { client } = state;
  const hosts = client.redirectHosts.join(", ");
  return (
    <AuthenticationSurface
      title={m.oauth_consent_title({ name: client.name })}
      description={m.oauth_consent_description()}
      showDescription={false}
    >
      <div className="space-y-5">
        {state.kind === "failed" ? (
          <Alert status="danger" role="alert">
            <Alert.Content>
              <Alert.Title>{m.oauth_consent_failed()}</Alert.Title>
              <Alert.Description>
                {m.oauth_consent_failed_description()}
              </Alert.Description>
            </Alert.Content>
          </Alert>
        ) : null}
        <div className="space-y-2 text-sm">
          <p className="m-0 font-medium">{m.oauth_consent_grants()}</p>
          <ul className="m-0 list-disc space-y-1 pl-5 text-default-600">
            <li>{m.oauth_consent_grant_read()}</li>
            <li>{m.oauth_consent_grant_write()}</li>
            <li>{m.oauth_consent_grant_publish()}</li>
          </ul>
        </div>
        <Alert status="warning">
          <Alert.Content>
            <Alert.Description>
              {m.oauth_consent_redirect({ hosts })}
            </Alert.Description>
          </Alert.Content>
        </Alert>
        <div className="flex gap-3">
          <Button
            fullWidth
            variant="outline"
            isDisabled={state.kind === "submitting"}
            isPending={state.kind === "submitting" && !state.accept}
            onPress={() => void answer(client, false)}
          >
            {m.oauth_consent_deny()}
          </Button>
          <Button
            fullWidth
            isDisabled={state.kind === "submitting"}
            isPending={state.kind === "submitting" && state.accept}
            onPress={() => void answer(client, true)}
          >
            {m.oauth_consent_allow()}
          </Button>
        </div>
        <p className="m-0 text-center text-xs text-default-500">
          {m.oauth_consent_revoke_hint()}
        </p>
      </div>
    </AuthenticationSurface>
  );
}
