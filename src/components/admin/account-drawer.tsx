import { Alert, Button, Drawer, Form, Input, Label } from "@heroui/react";
import { type FormEvent, useEffect, useState } from "react";

import { PASSWORD_MINIMUM_LENGTH } from "../../auth/policy";
import { m } from "../../paraglide/messages.js";
import styles from "./account-drawer.module.css";

type PasswordState =
  "ready" | "submitting" | "validation" | "request-failed" | "success";

/**
 * Account as an overlay drawer: read-only sign-in email, change password
 * (revokes every session), and sign-out for this browser session.
 */
export function AccountDrawer({
  open,
  onOpenChange,
  email,
  onSignOut,
  signOutState,
}: Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  email: string;
  onSignOut: () => void;
  signOutState: "ready" | "submitting" | "error";
}>) {
  const [passwordState, setPasswordState] = useState<PasswordState>("ready");
  const [newPasswordLength, setNewPasswordLength] = useState(0);
  const [currentPasswordError, setCurrentPasswordError] = useState<
    string | null
  >(null);
  const [newPasswordError, setNewPasswordError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setPasswordState("ready");
      setNewPasswordLength(0);
      setCurrentPasswordError(null);
      setNewPasswordError(null);
    }
  }, [open]);

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const currentPassword = String(formData.get("currentPassword") ?? "");
    const newPassword = String(formData.get("newPassword") ?? "");

    let nextCurrentError: string | null = null;
    let nextNewError: string | null = null;
    if (newPassword.length < PASSWORD_MINIMUM_LENGTH) {
      nextNewError = m.password_too_short({
        count: newPassword.length,
        minimum: PASSWORD_MINIMUM_LENGTH,
      });
    }
    if (nextNewError) {
      setCurrentPasswordError(null);
      setNewPasswordError(nextNewError);
      setPasswordState("validation");
      return;
    }

    setPasswordState("submitting");
    setCurrentPasswordError(null);
    setNewPasswordError(null);

    try {
      const response = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      if (response.ok) {
        setPasswordState("success");
        return;
      }
      if (response.status === 400) {
        nextCurrentError = m.current_password_incorrect();
        setCurrentPasswordError(nextCurrentError);
        setNewPasswordError(null);
        setPasswordState("validation");
        return;
      }
      setPasswordState("request-failed");
    } catch {
      setPasswordState("request-failed");
    }
  }

  const passwordHint =
    newPasswordLength >= PASSWORD_MINIMUM_LENGTH
      ? m.password_long_enough({ count: newPasswordLength })
      : m.password_chars_entered({ count: newPasswordLength });

  return (
    <Drawer.Backdrop isOpen={open} onOpenChange={onOpenChange}>
      <Drawer.Content placement="right" className="briefly-drawer-wide">
        <Drawer.Dialog aria-label={m.account_menu()}>
          <Drawer.Header>
            <div
              className={`flex w-full items-center justify-between gap-3`}
            >
              <div>
                <Drawer.Heading>
                  <strong>{m.account_menu()}</strong>
                </Drawer.Heading>
                <p className={`text-xs faint ${styles.description}`}>
                  {m.account_drawer_description()}
                </p>
              </div>
              <Drawer.CloseTrigger aria-label={m.close_account()} />
            </div>
          </Drawer.Header>
          <Drawer.Body className={`p-5`}>
            <div className={`flex flex-col gap-4`}>
              {signOutState === "error" ? (
                <Alert status="danger" role="alert">
                  <Alert.Content>
                    <Alert.Title>{m.sign_out_failed()}</Alert.Title>
                    <Alert.Description>
                      {m.sign_out_failed_description()}
                    </Alert.Description>
                  </Alert.Content>
                </Alert>
              ) : null}

              <div className={`${styles.card} p-5`}>
                <h2
                  className={`${styles.sectionTitle} text-base mt-0 mx-0 mb-5`}
                >
                  {m.sign_in_email()}
                </h2>
                <div className={`flex w-full flex-col gap-2`}>
                  <Label htmlFor="adminEmail">{m.email()}</Label>
                  <Input
                    fullWidth
                    id="adminEmail"
                    type="email"
                    value={email}
                    readOnly
                    aria-describedby="admin-email-note"
                  />
                  <p
                    className={`${styles.hint} text-xs m-0`}
                    id="admin-email-note"
                  >
                    {m.admin_email_note()}
                  </p>
                </div>
              </div>

              <div className={`${styles.card} `}>
                <div>
                  <h2
                    className={`${styles.sectionLead} text-base mt-0 mx-0 mb-2`}
                  >
                    {m.change_password()}
                  </h2>
                  <p className={`${styles.muted} text-sm m-0 mb-5`}>
                    {m.change_password_description()}
                  </p>
                </div>

                {passwordState === "success" ? (
                  <>
                    <Alert status="success" role="status">
                      <Alert.Content>
                        <Alert.Title>{m.password_updated()}</Alert.Title>
                        <Alert.Description>
                          {m.password_updated_description()}
                        </Alert.Description>
                      </Alert.Content>
                    </Alert>
                    <div
                      className={`flex flex-wrap items-center justify-end gap-3`}
                    >
                      <Button
                        type="button"
                        onPress={() => {
                          globalThis.location.replace(
                            "/admin/login?notice=password-updated",
                          );
                        }}
                      >
                        {m.continue_sign_in()}
                      </Button>
                    </div>
                  </>
                ) : (
                  <Form
                    className={`flex flex-col gap-4`}
                    onSubmit={changePassword}
                  >
                    {passwordState === "request-failed" ? (
                      <Alert status="danger" role="alert">
                        <Alert.Content>
                          <Alert.Title>
                            {m.unable_change_password()}
                          </Alert.Title>
                          <Alert.Description>
                            {m.unable_change_password_description()}
                          </Alert.Description>
                        </Alert.Content>
                      </Alert>
                    ) : null}
                    <div className={`flex flex-col gap-5`}>
                      <div
                        className={`flex w-full flex-col gap-2`}
                      >
                        <Label htmlFor="currentPassword">
                          {m.current_password()}
                        </Label>
                        <Input
                          fullWidth
                          id="currentPassword"
                          name="currentPassword"
                          type="password"
                          autoComplete="current-password"
                          required
                          aria-invalid={Boolean(currentPasswordError)}
                          aria-describedby={
                            currentPasswordError
                              ? "current-password-error"
                              : undefined
                          }
                        />
                        {currentPasswordError ? (
                          <p
                            className={`${styles.fieldError} text-xs m-0`}
                            id="current-password-error"
                            role="alert"
                          >
                            {currentPasswordError}
                          </p>
                        ) : null}
                      </div>
                      <div
                        className={`flex w-full flex-col gap-2`}
                      >
                        <Label htmlFor="newPassword">{m.new_password()}</Label>
                        <Input
                          fullWidth
                          id="newPassword"
                          name="newPassword"
                          type="password"
                          autoComplete="new-password"
                          maxLength={128}
                          required
                          aria-invalid={Boolean(newPasswordError)}
                          aria-describedby={
                            newPasswordError
                              ? "new-password-error"
                              : "new-password-hint"
                          }
                          onChange={(event) =>
                            setNewPasswordLength(event.target.value.length)
                          }
                        />
                        {newPasswordError ? (
                          <p
                            className={`${styles.fieldError} text-xs m-0`}
                            id="new-password-error"
                            role="alert"
                          >
                            {newPasswordError}
                          </p>
                        ) : (
                          <p
                            className={`${styles.hint} text-xs m-0`}
                            id="new-password-hint"
                          >
                            {m.minimum_password()} {passwordHint}
                          </p>
                        )}
                      </div>
                    </div>
                    <div
                      className={`flex flex-wrap items-center justify-end gap-3`}
                    >
                      <Button
                        type="submit"
                        isPending={passwordState === "submitting"}
                      >
                        {m.update_password()}
                      </Button>
                    </div>
                  </Form>
                )}
              </div>

              <div className={`${styles.card} p-5`}>
                <h2
                  className={`${styles.sectionTitle} text-base mt-0 mx-0 mb-5`}
                >
                  {m.session_section()}
                </h2>
                <div
                  className={`flex flex-wrap items-center justify-between gap-4`}
                >
                  <div>
                    <p className={`${styles.sessionLabel} text-sm m-0`}>
                      {m.sign_out_this_session()}
                    </p>
                    <p className={`${styles.muted} text-sm m-0`}>
                      {m.sign_out_this_session_description()}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    isPending={signOutState === "submitting"}
                    onPress={onSignOut}
                  >
                    {m.sign_out()}
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
