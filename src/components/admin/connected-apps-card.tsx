import { Alert, Button, Input, Label } from "@heroui/react";
import { useCallback, useEffect, useState } from "react";

import type { ConnectedApp } from "../../auth/connected-apps";
import { MCP_ENDPOINT_PATH } from "../../auth/policy";
import { getLocale } from "../../paraglide/runtime.js";
import { m } from "../../paraglide/messages.js";
import styles from "./account-drawer.module.css";

type ListState =
  | { kind: "loading" }
  | { kind: "failed" }
  | { kind: "ready"; apps: ConnectedApp[] };

/**
 * Connected Apps in the Account drawer: where to point an MCP client, and
 * every client that currently holds a token, each with a way to cut it off.
 */
export function ConnectedAppsCard({ open }: Readonly<{ open: boolean }>) {
  const [state, setState] = useState<ListState>({ kind: "loading" });
  const [pendingClientId, setPendingClientId] = useState<string | null>(null);
  const [disconnectFailed, setDisconnectFailed] = useState(false);
  const endpoint =
    typeof window === "undefined"
      ? MCP_ENDPOINT_PATH
      : `${window.location.origin}${MCP_ENDPOINT_PATH}`;

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/connected-apps", {
        headers: { accept: "application/json" },
      });
      if (!response.ok) throw new Error("Connected Apps unavailable");
      const body = (await response.json()) as { connectedApps: ConnectedApp[] };
      setState({ kind: "ready", apps: body.connectedApps });
    } catch {
      setState({ kind: "failed" });
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setState({ kind: "loading" });
    setDisconnectFailed(false);
    void load();
  }, [open, load]);

  async function disconnect(clientId: string) {
    setPendingClientId(clientId);
    setDisconnectFailed(false);
    try {
      const response = await fetch(
        `/api/admin/connected-apps/${encodeURIComponent(clientId)}`,
        { method: "DELETE" },
      );
      if (!response.ok && response.status !== 404) throw new Error();
      await load();
    } catch {
      setDisconnectFailed(true);
    } finally {
      setPendingClientId(null);
    }
  }

  const dateFormat = new Intl.DateTimeFormat(getLocale(), {
    dateStyle: "medium",
  });

  return (
    <section className={styles.card}>
      <h2 className={styles.sectionLead}>{m.connected_apps()}</h2>
      <p className={styles.sectionCopy}>{m.connected_apps_description()}</p>

      <div className={`flex w-full flex-col gap-2`}>
        <Label htmlFor="mcpEndpoint">{m.mcp_server_url()}</Label>
        <Input
          fullWidth
          className={styles.readonlyInput}
          id="mcpEndpoint"
          value={endpoint}
          readOnly
          aria-readonly="true"
          aria-describedby="mcp-endpoint-note"
          onFocus={(event) => event.currentTarget.select()}
        />
        <p className={styles.hint} id="mcp-endpoint-note">
          {m.mcp_server_url_hint()}
        </p>
      </div>

      <div className={styles.appList}>
        {disconnectFailed ? (
          <Alert status="danger" role="alert">
            <Alert.Content>
              <Alert.Title>{m.disconnect_failed()}</Alert.Title>
            </Alert.Content>
          </Alert>
        ) : null}
        {state.kind === "loading" ? (
          <p className={styles.hint} role="status">
            {m.connected_apps_loading()}
          </p>
        ) : state.kind === "failed" ? (
          <Alert status="danger" role="alert">
            <Alert.Content>
              <Alert.Title>{m.connected_apps_failed()}</Alert.Title>
            </Alert.Content>
          </Alert>
        ) : state.apps.length === 0 ? (
          <p className={styles.hint}>{m.connected_apps_empty()}</p>
        ) : (
          <ul className={styles.appRows}>
            {state.apps.map((app) => (
              <li key={app.clientId} className={styles.sessionRow}>
                <div>
                  <p className={styles.sessionLabel}>{app.name}</p>
                  <p className={styles.sessionCopy}>
                    {m.connected_app_meta({
                      hosts: app.redirectHosts.join(", "),
                      date: dateFormat.format(new Date(app.lastAuthorizedAt)),
                    })}
                  </p>
                </div>
                <Button
                  type="button"
                  className={styles.sessionAction}
                  variant="outline"
                  isPending={pendingClientId === app.clientId}
                  isDisabled={pendingClientId !== null}
                  onPress={() => void disconnect(app.clientId)}
                >
                  {m.disconnect()}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
