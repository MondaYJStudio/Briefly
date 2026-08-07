import {
  Alert,
  Button,
  Drawer,
  Form,
  Input,
  InputGroup,
  Label,
} from "@heroui/react";
import {
  type FormEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

import { PASSWORD_MINIMUM_LENGTH } from "../../auth/policy";
import { m } from "../../paraglide/messages.js";
import { AdminIcon } from "./icons";
import styles from "./account-drawer.module.css";

type PasswordState =
  "ready" | "submitting" | "validation" | "request-failed" | "success";

function AccountCard({ children }: Readonly<{ children: ReactNode }>) {
  return <section className={styles.card}>{children}</section>;
}

function PasswordVisibilityToggle({
  visible,
  onToggle,
  labelledBy,
}: Readonly<{
  visible: boolean;
  onToggle: () => void;
  labelledBy: string;
}>) {
  return (
    <button
      type="button"
      className={styles.passwordToggle}
      aria-pressed={visible}
      aria-label={visible ? m.hide_password() : m.show_password()}
      aria-controls={labelledBy}
      onClick={onToggle}
    >
      <AdminIcon name={visible ? "eye-off" : "eye"} size={18} />
    </button>
  );
}

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
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [currentPasswordError, setCurrentPasswordError] = useState<
    string | null
  >(null);
  const [newPasswordError, setNewPasswordError] = useState<string | null>(null);
  const currentPasswordRef = useRef<HTMLInputElement>(null);
  const newPasswordRef = useRef<HTMLInputElement>(null);
  const currentPasswordId = useId();
  const newPasswordId = useId();

  useEffect(() => {
    if (!open) {
      setPasswordState("ready");
      setNewPasswordLength(0);
      setShowCurrentPassword(false);
      setShowNewPassword(false);
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
      newPasswordRef.current?.focus();
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
        currentPasswordRef.current?.focus();
        return;
      }
      setPasswordState("request-failed");
    } catch {
      setPasswordState("request-failed");
    }
  }

  const passwordReady = newPasswordLength >= PASSWORD_MINIMUM_LENGTH;
  const passwordHint = passwordReady
    ? m.password_long_enough({ count: newPasswordLength })
    : m.password_chars_entered({ count: newPasswordLength });
  const meterPercent = Math.min(
    100,
    Math.round((newPasswordLength / PASSWORD_MINIMUM_LENGTH) * 100),
  );

  return (
    <Drawer.Backdrop isOpen={open} onOpenChange={onOpenChange}>
      <Drawer.Content placement="right" className="briefly-drawer-wide">
        <Drawer.Dialog aria-label={m.account_menu()}>
          <Drawer.Header>
            <div className={`flex w-full items-center justify-between gap-3`}>
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

              <AccountCard>
                <h2 className={styles.sectionTitle}>{m.sign_in_email()}</h2>
                <div className={`flex w-full flex-col gap-2`}>
                  <Label htmlFor="adminEmail">{m.email()}</Label>
                  <Input
                    fullWidth
                    className={styles.readonlyInput}
                    id="adminEmail"
                    type="email"
                    value={email}
                    readOnly
                    aria-readonly="true"
                    aria-describedby="admin-email-note"
                  />
                  <p className={styles.hint} id="admin-email-note">
                    {m.admin_email_note()}
                  </p>
                </div>
              </AccountCard>

              <AccountCard>
                <h2 className={styles.sectionLead}>{m.change_password()}</h2>
                <div className={styles.warning} role="note">
                  <span className={styles.warningIcon} aria-hidden="true">
                    <AdminIcon name="alert" size={16} />
                  </span>
                  <p className="m-0">{m.change_password_description()}</p>
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
                    <div className={`${styles.actions} mt-4`}>
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
                    className={`flex flex-col gap-5`}
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
                        className={`${styles.passwordField} flex w-full flex-col gap-2`}
                      >
                        <Label htmlFor={currentPasswordId}>
                          {m.current_password()}
                        </Label>
                        <InputGroup fullWidth>
                          <InputGroup.Input
                            ref={currentPasswordRef}
                            id={currentPasswordId}
                            name="currentPassword"
                            type={
                              showCurrentPassword ? "text" : "password"
                            }
                            autoComplete="current-password"
                            required
                            aria-invalid={Boolean(currentPasswordError)}
                            aria-describedby={
                              currentPasswordError
                                ? "current-password-error"
                                : undefined
                            }
                          />
                          <InputGroup.Suffix>
                            <PasswordVisibilityToggle
                              visible={showCurrentPassword}
                              labelledBy={currentPasswordId}
                              onToggle={() =>
                                setShowCurrentPassword((value) => !value)
                              }
                            />
                          </InputGroup.Suffix>
                        </InputGroup>
                        {currentPasswordError ? (
                          <p
                            className={styles.fieldError}
                            id="current-password-error"
                            role="alert"
                          >
                            {currentPasswordError}
                          </p>
                        ) : null}
                      </div>

                      <div
                        className={`${styles.passwordField} flex w-full flex-col gap-2`}
                      >
                        <Label htmlFor={newPasswordId}>
                          {m.new_password()}
                        </Label>
                        <InputGroup fullWidth>
                          <InputGroup.Input
                            ref={newPasswordRef}
                            id={newPasswordId}
                            name="newPassword"
                            type={showNewPassword ? "text" : "password"}
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
                          <InputGroup.Suffix>
                            <PasswordVisibilityToggle
                              visible={showNewPassword}
                              labelledBy={newPasswordId}
                              onToggle={() =>
                                setShowNewPassword((value) => !value)
                              }
                            />
                          </InputGroup.Suffix>
                        </InputGroup>
                        {newPasswordError ? (
                          <p
                            className={styles.fieldError}
                            id="new-password-error"
                            role="alert"
                          >
                            {newPasswordError}
                          </p>
                        ) : (
                          <div className={styles.meter} id="new-password-hint">
                            <div
                              className={styles.meterTrack}
                              aria-hidden="true"
                            >
                              <div
                                className={styles.meterFill}
                                data-ready={passwordReady || undefined}
                                style={{ width: `${meterPercent}%` }}
                              />
                            </div>
                            <p className={styles.hint}>
                              {m.minimum_password()} {passwordHint}
                            </p>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className={styles.actions}>
                      <Button
                        type="submit"
                        isPending={passwordState === "submitting"}
                      >
                        {m.update_password()}
                      </Button>
                    </div>
                  </Form>
                )}
              </AccountCard>

              <AccountCard>
                <h2 className={styles.sectionTitle}>{m.session_section()}</h2>
                <div className={styles.sessionRow}>
                  <div>
                    <p className={styles.sessionLabel}>
                      {m.sign_out_this_session()}
                    </p>
                    <p className={styles.sessionCopy}>
                      {m.sign_out_this_session_description()}
                    </p>
                  </div>
                  <Button
                    type="button"
                    className={styles.sessionAction}
                    variant="outline"
                    isPending={signOutState === "submitting"}
                    onPress={onSignOut}
                  >
                    {m.sign_out()}
                  </Button>
                </div>
              </AccountCard>
            </div>
          </Drawer.Body>
        </Drawer.Dialog>
      </Drawer.Content>
    </Drawer.Backdrop>
  );
}
