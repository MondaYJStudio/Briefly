import { createFileRoute, Outlet } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { getApiClient } from "./api.$";
import { loadAdministratorIdentity } from "../auth/load-administrator-identity";
import {
  AdminShell,
  type AdminDrawerKind,
  type AdminTheme,
} from "../components/admin/admin-shell";
import { AdminContextProvider } from "../components/admin/admin-context";
import { AccountDrawer } from "../components/admin/account-drawer";
import { SettingsDrawer } from "../components/admin/settings-drawer";
import type { SiteSettings } from "../site-settings/site-settings";

export const Route = createFileRoute("/admin")({
  loader: async () => ({
    identity: await loadAdministratorIdentity(),
  }),
  component: AdminLayout,
});

function AdminLayout() {
  const { identity } = Route.useLoaderData();
  const [drawer, setDrawer] = useState<AdminDrawerKind | null>(null);
  const [theme, setTheme] = useState<AdminTheme>("light");
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const [signOutState, setSignOutState] = useState<
    "ready" | "submitting" | "error"
  >("ready");
  const [settings, setSettings] = useState<SiteSettings | null>(null);

  useEffect(() => {
    let active = true;
    void getApiClient()
      .admin["site-settings"].get()
      .then((response) => {
        if (response.status !== 200 || !response.data) {
          throw new Error("Site Settings unavailable");
        }
        if (active) setSettings(response.data);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const storedTheme = globalThis.localStorage?.getItem("briefly-admin-theme");
    if (storedTheme === "light" || storedTheme === "dark") {
      setTheme(storedTheme);
    } else if (
      globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches
    ) {
      setTheme("dark");
    }
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const previous = root.getAttribute("data-theme");
    root.setAttribute("data-theme", theme);
    return () => {
      if (previous === null) root.removeAttribute("data-theme");
      else root.setAttribute("data-theme", previous);
    };
  }, [theme]);

  function openDrawer(nextDrawer: AdminDrawerKind) {
    setDrawer(nextDrawer);
    setMobileNavigationOpen(false);
  }

  function toggleTheme() {
    setTheme((current) => {
      const next = current === "light" ? "dark" : "light";
      globalThis.localStorage?.setItem("briefly-admin-theme", next);
      return next;
    });
  }

  async function signOut() {
    setSignOutState("submitting");
    try {
      const response = await fetch("/api/auth/sign-out", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      if (response.ok) {
        globalThis.location.replace("/admin/login");
      } else {
        setSignOutState("error");
      }
    } catch {
      setSignOutState("error");
    }
  }

  return (
    <AdminShell
      identity={identity}
      theme={theme}
      mobileNavigationOpen={mobileNavigationOpen}
      signOutPending={signOutState === "submitting"}
      signOutError={signOutState === "error"}
      onToggleTheme={toggleTheme}
      onOpenDrawer={openDrawer}
      onSignOut={() => void signOut()}
      onMobileNavigationChange={setMobileNavigationOpen}
    >
      <AdminContextProvider value={{ siteSettings: settings }}>
        <Outlet />
      </AdminContextProvider>

      <SettingsDrawer
        open={drawer === "settings"}
        onOpenChange={(open) => setDrawer(open ? "settings" : null)}
        settings={settings}
        onSettingsChange={setSettings}
      />
      <AccountDrawer
        open={drawer === "account"}
        onOpenChange={(open) => setDrawer(open ? "account" : null)}
        email={identity.email}
        onSignOut={() => void signOut()}
        signOutState={signOutState}
      />
    </AdminShell>
  );
}
