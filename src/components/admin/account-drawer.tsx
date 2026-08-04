import { Alert, Button, Drawer, Form, Input, Label } from "@heroui/react";
import { type FormEvent, useState } from "react";

/**
 * Account as an overlay drawer: read-only sign-in email, change password
 * (revokes every session), and sign-out for this browser session.
 */
export function AccountDrawer({
  open,
  onOpenChange,
  onSignOut,
  signOutState,
}: Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSignOut: () => void;
  signOutState: "ready" | "submitting" | "error";
}>) {
  const [passwordState, setPasswordState] = useState<
    "ready" | "submitting" | "error"
  >("ready");
  const [newPasswordLength, setNewPasswordLength] = useState(0);

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
    <Drawer.Backdrop isOpen={open} onOpenChange={onOpenChange}>
      <Drawer.Content placement="right" className="briefly-drawer-wide">
        <Drawer.Dialog aria-label="Account">
          <Drawer.Header>
            <div className="briefly-drawer-head">
              <div>
                <Drawer.Heading>
                  <strong>Account</strong>
                </Drawer.Heading>
                <p className="small faint" style={{ marginTop: 2 }}>
                  The single administrator — no other users, roles, or
                  invitations by design.
                </p>
              </div>
              <Drawer.CloseTrigger aria-label="Close account" />
            </div>
          </Drawer.Header>
          <Drawer.Body style={{ padding: "var(--space-5)" }}>
            <div className="stack">
              {signOutState === "error" ? (
                <Alert status="danger" role="alert">
                  <Alert.Content>
                    <Alert.Title>Unable to sign out</Alert.Title>
                    <Alert.Description>Please try again.</Alert.Description>
                  </Alert.Content>
                </Alert>
              ) : null}

              <div className="card card-pad">
                <h2
                  style={{
                    fontSize: "var(--text-medium)",
                    fontWeight: 700,
                    marginBottom: "var(--space-5)",
                  }}
                >
                  Sign-in email
                </h2>
                <SettingsEmailField />
              </div>

              <Form className="card card-pad stack" onSubmit={changePassword}>
                <div>
                  <h2
                    style={{
                      fontSize: "var(--text-medium)",
                      fontWeight: 700,
                      marginBottom: "var(--space-2)",
                    }}
                  >
                    Change password
                  </h2>
                  <p className="small muted">
                    After a successful change,{" "}
                    <strong>every existing session is revoked</strong> —
                    including this one — and you return to the sign-in page.
                  </p>
                </div>
                {passwordState === "error" ? (
                  <Alert status="danger" role="alert">
                    <Alert.Content>
                      <Alert.Title>Unable to change password</Alert.Title>
                      <Alert.Description>
                        Check the current password and new password, then try
                        again.
                      </Alert.Description>
                    </Alert.Content>
                  </Alert>
                ) : null}
                <div className="field-stack">
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "var(--space-2)",
                    }}
                  >
                    <Label htmlFor="currentPassword">Current password</Label>
                    <Input
                      fullWidth
                      id="currentPassword"
                      name="currentPassword"
                      type="password"
                      autoComplete="current-password"
                      required
                    />
                  </div>
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "var(--space-2)",
                    }}
                  >
                    <Label htmlFor="newPassword">New password</Label>
                    <Input
                      fullWidth
                      id="newPassword"
                      name="newPassword"
                      type="password"
                      autoComplete="new-password"
                      minLength={12}
                      maxLength={128}
                      required
                      aria-describedby="new-password-hint"
                      onChange={(event) =>
                        setNewPasswordLength(event.target.value.length)
                      }
                    />
                    <p className="small faint" id="new-password-hint">
                      Minimum 12 characters. {newPasswordLength} entered so far
                      {newPasswordLength >= 12 ? " — long enough." : "."}
                    </p>
                  </div>
                </div>
                <div className="row" style={{ justifyContent: "flex-end" }}>
                  <Button
                    type="submit"
                    isPending={passwordState === "submitting"}
                  >
                    Update password
                  </Button>
                </div>
              </Form>

              <div className="card card-pad">
                <h2
                  style={{
                    fontSize: "var(--text-medium)",
                    fontWeight: 700,
                    marginBottom: "var(--space-5)",
                  }}
                >
                  Session
                </h2>
                <div className="row-between wrap">
                  <div>
                    <p className="small" style={{ fontWeight: 600 }}>
                      Sign out of this session
                    </p>
                    <p className="small muted">
                      Ends the current browser session only. MFA is not
                      available in this version.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    isPending={signOutState === "submitting"}
                    onPress={onSignOut}
                  >
                    Sign out
                  </Button>
                </div>
              </div>
            </div>
          </Drawer.Body>
        </Drawer.Dialog>
      </Drawer.Content>
    </Drawer.Backdrop>
  );
}

function SettingsEmailField() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-2)",
      }}
    >
      <Label htmlFor="adminEmail">Email</Label>
      <Input
        fullWidth
        id="adminEmail"
        type="email"
        value="Administrator"
        readOnly
        aria-describedby="admin-email-note"
      />
      <p className="small faint" id="admin-email-note">
        Fixed at initialization. This address only signs you in — the public
        byline lives in Settings.
      </p>
    </div>
  );
}
