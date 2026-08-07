import {
  Alert,
  AlertDialog,
  Button,
  Form,
  Input,
  Label,
  Modal,
  TextField,
} from "@heroui/react";
import {
  type FormEvent,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

import { AdminIcon } from "../components/admin/icons";
import { StatusChip } from "../components/admin/status-chip";
import { m } from "../paraglide/messages.js";
import { getApiClient } from "../routes/api.$";
import type { InstalledPublicTemplate } from "./public-templates";
import styles from "./public-templates-admin.module.css";

type PageState =
  | "loading"
  | "ready"
  | "error"
  | "installing"
  | "install-invalid"
  | "install-failed"
  | "installed"
  | "activating"
  | "activated"
  | "activate-failed"
  | "deactivating"
  | "deactivated"
  | "deactivate-failed"
  | "deleting"
  | "deleted"
  | "delete-failed"
  | "delete-blocked";

function hasActiveTemplate(templates: InstalledPublicTemplate[]): boolean {
  return templates.some((template) => template.active);
}

function ListSkeleton() {
  return (
    <div className={styles.card}>
      <ul
        className={`${styles.list} m-0 p-0`}
        aria-busy="true"
        aria-label={m.public_templates_loading_label()}
      >
        {[0, 1, 2].map((index) => (
          <li
            key={index}
            className={`${styles.skeletonRow} flex flex-wrap items-start justify-between gap-4 py-4 px-5`}
          >
            <div className={`min-w-0 flex-1 flex flex-col gap-2`}>
              <span className={`${styles.skeleton} block h-4 w-40`} />
              <span className={`${styles.skeleton} block h-3 w-64`} />
            </div>
            <div
              className={`${styles.skeletonSide} flex flex-wrap items-center shrink-0 gap-2`}
            >
              <span className={`${styles.skeleton} block h-8 w-20`} />
              <span className={`${styles.skeleton} block h-8 w-20`} />
            </div>
          </li>
        ))}
      </ul>
      <span className="visually-hidden" role="status">
        {m.public_templates_loading()}
      </span>
    </div>
  );
}

/**
 * Admin workspace for Installed Public Templates: list, zip/URL install,
 * activate/deactivate, and delete (never while active).
 */
export function PublicTemplatesAdmin() {
  const [templates, setTemplates] = useState<InstalledPublicTemplate[]>([]);
  const [state, setState] = useState<PageState>("loading");
  const [issues, setIssues] = useState<string[]>([]);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [urlOpen, setUrlOpen] = useState(false);
  const [urlValue, setUrlValue] = useState("");
  const [deleteTarget, setDeleteTarget] =
    useState<InstalledPublicTemplate | null>(null);
  const deleteTriggerRef = useRef<HTMLElement | null>(null);
  const urlInputId = useId();
  const zipInputId = useId();

  async function refreshTemplates(): Promise<boolean> {
    try {
      const response = await getApiClient().admin["public-templates"].get();
      if (response.status === 200 && response.data) {
        setTemplates(response.data.templates);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setState("loading");
      const ok = await refreshTemplates();
      if (cancelled) return;
      setState(ok ? "ready" : "error");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function closeUpload(open: boolean) {
    setUploadOpen(open);
  }

  function closeUrl(open: boolean) {
    if (!open) setUrlValue("");
    setUrlOpen(open);
  }

  async function installFromZip(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("installing");
    setIssues([]);
    const form = event.currentTarget;
    const file = new FormData(form).get("publicTemplateFile");
    if (!(file instanceof File) || file.size === 0) {
      setIssues([m.public_templates_zip_required()]);
      setState("install-invalid");
      return;
    }

    try {
      const response = await getApiClient().admin["public-templates"].post({
        file,
      });
      if (response.status === 201 && response.data) {
        const installed = response.data;
        setTemplates((current) => {
          const withoutSameManifest = current.filter(
            (template) => template.manifestId !== installed.manifestId,
          );
          return [installed, ...withoutSameManifest];
        });
        setUploadOpen(false);
        form.reset();
        setState("installed");
        return;
      }

      const error = response.error?.value;
      if (error && "issues" in error && Array.isArray(error.issues)) {
        setIssues(error.issues.map((issue) => issue.message));
        setState("install-invalid");
        return;
      }
      setState("install-failed");
    } catch {
      setState("install-failed");
    }
  }

  async function installFromUrl(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("installing");
    setIssues([]);
    const url = urlValue.trim();
    if (!url) {
      setIssues([m.public_templates_url_required()]);
      setState("install-invalid");
      return;
    }

    try {
      const response = await getApiClient()
        .admin["public-templates"]["from-url"].post({ url });
      if (response.status === 201 && response.data) {
        const installed = response.data;
        setTemplates((current) => {
          const withoutSameManifest = current.filter(
            (template) => template.manifestId !== installed.manifestId,
          );
          return [installed, ...withoutSameManifest];
        });
        setUrlOpen(false);
        setUrlValue("");
        setState("installed");
        return;
      }

      const error = response.error?.value;
      if (error && "issues" in error && Array.isArray(error.issues)) {
        setIssues(error.issues.map((issue) => issue.message));
        setState("install-invalid");
        return;
      }
      setState("install-failed");
    } catch {
      setState("install-failed");
    }
  }

  async function activateTemplate(template: InstalledPublicTemplate) {
    setState("activating");
    try {
      const response = await getApiClient()
        .admin["public-templates"]({ installationId: template.installationId })
        .activate.post();
      if (response.status === 200 && response.data) {
        const activated = response.data;
        setTemplates((current) =>
          current.map((entry) =>
            entry.installationId === activated.installationId
              ? activated
              : { ...entry, active: false },
          ),
        );
        setState("activated");
        return;
      }
      setState("activate-failed");
    } catch {
      setState("activate-failed");
    }
  }

  async function deactivateActive() {
    setState("deactivating");
    try {
      const response = await getApiClient()
        .admin["public-templates"].deactivate.post();
      if (response.status === 200 && response.data?.active === false) {
        setTemplates((current) =>
          current.map((entry) => ({ ...entry, active: false })),
        );
        setState("deactivated");
        return;
      }
      setState("deactivate-failed");
    } catch {
      setState("deactivate-failed");
    }
  }

  async function deleteInstallation(template: InstalledPublicTemplate) {
    setState("deleting");
    try {
      const response = await getApiClient()
        .admin["public-templates"]({ installationId: template.installationId })
        .delete();
      if (response.status === 204) {
        setTemplates((current) =>
          current.filter(
            (entry) => entry.installationId !== template.installationId,
          ),
        );
        setDeleteTarget(null);
        setState("deleted");
        return;
      }
      if (response.status === 409) {
        setDeleteTarget(null);
        setState("delete-blocked");
        return;
      }
      setState("delete-failed");
    } catch {
      setState("delete-failed");
    }
  }

  const busy =
    state === "installing" ||
    state === "activating" ||
    state === "deactivating" ||
    state === "deleting";
  const showBuiltInNote =
    state !== "loading" && state !== "error" && !hasActiveTemplate(templates);

  return (
    <main
      className={`flex min-w-0 flex-1 flex-col max-w-6xl w-full mx-auto pt-8 px-10 pb-16 max-[860px]:pt-5 max-[860px]:px-4 max-[860px]:pb-10`}
      id="admin-main"
    >
      <header
        className={`flex flex-wrap items-end justify-between mb-8 gap-4 max-[860px]:mb-5`}
      >
        <div>
          <h1 className={`${styles.pageTitle} text-2xl`}>
            {m.public_templates_page_title()}
          </h1>
          <p className={`${styles.pageDesc} mt-2`}>
            {m.public_templates_page_description()}
          </p>
        </div>
        <div className={`flex flex-wrap items-center max-[860px]:w-full gap-2`}>
          <Button
            type="button"
            variant="secondary"
            isDisabled={busy}
            onPress={() => {
              setUploadOpen(false);
              setUrlOpen(true);
            }}
          >
            <AdminIcon name="globe" size={16} />
            {m.public_templates_install_from_url()}
          </Button>
          <Button
            type="button"
            isDisabled={busy}
            onPress={() => {
              setUrlOpen(false);
              setUploadOpen(true);
            }}
          >
            <AdminIcon name="upload" size={16} />
            {m.public_templates_upload_zip()}
          </Button>
        </div>
      </header>

      <div className={`flex flex-col gap-4`}>
        {showBuiltInNote ? (
          <div
            className={`${styles.note} flex items-start text-sm gap-3 py-3 px-4`}
            role="note"
          >
            <AdminIcon name="globe" strokeWidth={1.8} />
            <div>{m.public_templates_built_in_note()}</div>
          </div>
        ) : null}

        {state === "installing" && !uploadOpen && !urlOpen ? (
          <Alert status="default" role="status">
            <Alert.Content>
              <Alert.Title>{m.public_templates_installing()}</Alert.Title>
            </Alert.Content>
          </Alert>
        ) : state === "install-invalid" && !uploadOpen && !urlOpen ? (
          <Alert status="danger" role="alert">
            <Alert.Content>
              <Alert.Title>
                {m.public_templates_install_failed_title()}
              </Alert.Title>
              <Alert.Description>
                <ul className="list-disc pl-5">
                  {issues.map((issue) => (
                    <li key={issue}>{issue}</li>
                  ))}
                </ul>
              </Alert.Description>
            </Alert.Content>
          </Alert>
        ) : state === "install-failed" ? (
          <Alert status="danger" role="alert">
            <Alert.Content>
              <Alert.Title>
                {m.public_templates_install_failed_title()}
              </Alert.Title>
              <Alert.Description>
                {m.public_templates_install_failed_generic()}
              </Alert.Description>
            </Alert.Content>
          </Alert>
        ) : state === "installed" ? (
          <Alert status="success" role="status">
            <Alert.Content>
              <Alert.Title>{m.public_templates_installed_title()}</Alert.Title>
            </Alert.Content>
          </Alert>
        ) : state === "activated" ? (
          <Alert status="success" role="status">
            <Alert.Content>
              <Alert.Title>{m.public_templates_activated_title()}</Alert.Title>
            </Alert.Content>
          </Alert>
        ) : state === "deactivated" ? (
          <Alert status="success" role="status">
            <Alert.Content>
              <Alert.Title>
                {m.public_templates_deactivated_title()}
              </Alert.Title>
            </Alert.Content>
          </Alert>
        ) : state === "deleted" ? (
          <Alert status="success" role="status">
            <Alert.Content>
              <Alert.Title>{m.public_templates_deleted_title()}</Alert.Title>
            </Alert.Content>
          </Alert>
        ) : state === "activate-failed" ? (
          <Alert status="danger" role="alert">
            <Alert.Content>
              <Alert.Title>
                {m.public_templates_activate_failed_title()}
              </Alert.Title>
            </Alert.Content>
          </Alert>
        ) : state === "deactivate-failed" ? (
          <Alert status="danger" role="alert">
            <Alert.Content>
              <Alert.Title>
                {m.public_templates_deactivate_failed_title()}
              </Alert.Title>
            </Alert.Content>
          </Alert>
        ) : state === "delete-blocked" ? (
          <Alert status="warning" role="alert">
            <Alert.Content>
              <Alert.Title>
                {m.public_templates_delete_blocked_title()}
              </Alert.Title>
              <Alert.Description>
                {m.public_templates_delete_blocked_description()}
              </Alert.Description>
            </Alert.Content>
          </Alert>
        ) : state === "delete-failed" ? (
          <Alert status="danger" role="alert">
            <Alert.Content>
              <Alert.Title>
                {m.public_templates_delete_failed_title()}
              </Alert.Title>
            </Alert.Content>
          </Alert>
        ) : null}

        {state === "loading" ? (
          <ListSkeleton />
        ) : state === "error" ? (
          <div className={styles.card}>
            <div
              className={`flex flex-col items-center text-center py-16 px-6`}
            >
              <div
                className={`${styles.emptyIcon} ${styles.emptyIconDanger} grid place-items-center mb-4`}
              >
                <AdminIcon name="alert" size={24} />
              </div>
              <h3 className={`${styles.emptyTitle} text-base`}>
                {m.public_templates_load_failed_title()}
              </h3>
              <p className={`${styles.emptyCopy} mt-1`}>
                {m.public_templates_load_failed_description()}
              </p>
              <div className={`flex mt-5 gap-2`}>
                <Button
                  type="button"
                  onPress={() => {
                    setState("loading");
                    void refreshTemplates().then((ok) =>
                      setState(ok ? "ready" : "error"),
                    );
                  }}
                >
                  {m.public_templates_retry()}
                </Button>
              </div>
            </div>
          </div>
        ) : templates.length === 0 ? (
          <div className={styles.card}>
            <div
              className={`flex flex-col items-center text-center py-16 px-6`}
            >
              <div
                className={`${styles.emptyIcon} grid place-items-center mb-4`}
              >
                <AdminIcon name="globe" size={24} />
              </div>
              <h3 className={`${styles.emptyTitle} text-base`}>
                {m.public_templates_empty_title()}
              </h3>
              <p className={`${styles.emptyCopy} mt-1`}>
                {m.public_templates_empty_description()}
              </p>
            </div>
          </div>
        ) : (
          <div className={styles.card}>
            <ul
              className={`${styles.list} m-0 p-0`}
              aria-label={m.public_templates_list_label()}
            >
              {templates.map((template) => (
                <li
                  key={template.installationId}
                  className={`${styles.row} flex flex-wrap items-start justify-between gap-4 py-4 px-5`}
                >
                  <div className={`min-w-0 flex-1`}>
                    <div className={`flex flex-wrap items-center gap-2 mb-1`}>
                      <span className={`${styles.title} text-base`}>
                        {template.name}
                      </span>
                      {template.active ? (
                        <StatusChip variant="success" dot>
                          {m.public_templates_active_chip()}
                        </StatusChip>
                      ) : (
                        <StatusChip variant="default">
                          {m.public_templates_inactive_chip()}
                        </StatusChip>
                      )}
                    </div>
                    <span
                      className={`${styles.meta} flex flex-wrap text-sm gap-3`}
                    >
                      <span>
                        {m.public_templates_version({
                          version: template.version,
                        })}
                      </span>
                      <span>
                        {m.public_templates_manifest_id({
                          id: template.manifestId,
                        })}
                      </span>
                    </span>
                  </div>
                  <div
                    className={`${styles.side} flex flex-wrap items-center shrink-0 gap-2`}
                  >
                    {template.active ? (
                      <Button
                        size="sm"
                        type="button"
                        variant="secondary"
                        aria-label={m.public_templates_deactivate_named({
                          name: template.name,
                        })}
                        isDisabled={busy}
                        isPending={state === "deactivating"}
                        onPress={() => void deactivateActive()}
                      >
                        {m.public_templates_deactivate()}
                      </Button>
                    ) : (
                      <>
                        <Button
                          size="sm"
                          type="button"
                          variant="secondary"
                          aria-label={m.public_templates_activate_named({
                            name: template.name,
                          })}
                          isDisabled={busy}
                          isPending={state === "activating"}
                          onPress={() => void activateTemplate(template)}
                        >
                          {m.public_templates_activate()}
                        </Button>
                        <Button
                          size="sm"
                          type="button"
                          variant="danger-soft"
                          aria-label={m.public_templates_delete_named({
                            name: template.name,
                          })}
                          isDisabled={busy}
                          onPress={(event) => {
                            const target = event.target;
                            deleteTriggerRef.current =
                              target instanceof HTMLElement ? target : null;
                            setDeleteTarget(template);
                          }}
                        >
                          {m.public_templates_delete()}
                        </Button>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <Modal.Backdrop isOpen={uploadOpen} onOpenChange={closeUpload}>
        <Modal.Container>
          <Modal.Dialog aria-label={m.public_templates_upload_zip()}>
            <Modal.Header>
              <div className="briefly-drawer-head flex items-center justify-between gap-3 w-full">
                <Modal.Heading>{m.public_templates_upload_zip()}</Modal.Heading>
                <Modal.CloseTrigger
                  aria-label={m.public_templates_close_upload()}
                />
              </div>
            </Modal.Header>
            <Form onSubmit={installFromZip}>
              <Modal.Body>
                {state === "install-invalid" && issues.length > 0 ? (
                  <Alert status="danger" role="alert" className="mb-4">
                    <Alert.Content>
                      <Alert.Title>
                        {m.public_templates_install_failed_title()}
                      </Alert.Title>
                      <Alert.Description>
                        <ul className="list-disc pl-5">
                          {issues.map((issue) => (
                            <li key={issue}>{issue}</li>
                          ))}
                        </ul>
                      </Alert.Description>
                    </Alert.Content>
                  </Alert>
                ) : null}
                <label
                  className={`${styles.dropzone} relative block text-center cursor-pointer p-6`}
                  htmlFor={zipInputId}
                >
                  <AdminIcon name="upload" size={24} />
                  <p className={`${styles.dropzoneTitle} text-sm mt-2`}>
                    {m.public_templates_choose_zip()}
                  </p>
                  <input
                    className={styles.dropzoneInput}
                    id={zipInputId}
                    name="publicTemplateFile"
                    type="file"
                    accept=".zip,application/zip,application/x-zip-compressed"
                    required
                    aria-label={m.public_templates_zip_input()}
                  />
                </label>
              </Modal.Body>
              <Modal.Footer>
                <Button
                  type="button"
                  variant="secondary"
                  onPress={() => closeUpload(false)}
                >
                  {m.public_templates_cancel()}
                </Button>
                <Button type="submit" isPending={state === "installing"}>
                  {m.public_templates_install_zip()}
                </Button>
              </Modal.Footer>
            </Form>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>

      <Modal.Backdrop isOpen={urlOpen} onOpenChange={closeUrl}>
        <Modal.Container>
          <Modal.Dialog aria-label={m.public_templates_install_from_url()}>
            <Modal.Header>
              <div className="briefly-drawer-head flex items-center justify-between gap-3 w-full">
                <Modal.Heading>
                  {m.public_templates_install_from_url()}
                </Modal.Heading>
                <Modal.CloseTrigger
                  aria-label={m.public_templates_close_url_install()}
                />
              </div>
            </Modal.Header>
            <Form onSubmit={installFromUrl}>
              <Modal.Body>
                {state === "install-invalid" && issues.length > 0 ? (
                  <Alert status="danger" role="alert" className="mb-4">
                    <Alert.Content>
                      <Alert.Title>
                        {m.public_templates_install_failed_title()}
                      </Alert.Title>
                      <Alert.Description>
                        <ul className="list-disc pl-5">
                          {issues.map((issue) => (
                            <li key={issue}>{issue}</li>
                          ))}
                        </ul>
                      </Alert.Description>
                    </Alert.Content>
                  </Alert>
                ) : null}
                <TextField name="url" className="flex flex-col gap-2">
                  <Label htmlFor={urlInputId}>
                    {m.public_templates_url_label()}
                  </Label>
                  <Input
                    fullWidth
                    id={urlInputId}
                    type="url"
                    value={urlValue}
                    placeholder={m.public_templates_url_placeholder()}
                    autoComplete="off"
                    onChange={(event) => setUrlValue(event.target.value)}
                  />
                </TextField>
              </Modal.Body>
              <Modal.Footer>
                <Button
                  type="button"
                  variant="secondary"
                  onPress={() => closeUrl(false)}
                >
                  {m.public_templates_cancel()}
                </Button>
                <Button type="submit" isPending={state === "installing"}>
                  {m.public_templates_install_url_action()}
                </Button>
              </Modal.Footer>
            </Form>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>

      <AlertDialog.Backdrop
        isOpen={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
            queueMicrotask(() => deleteTriggerRef.current?.focus());
          }
        }}
      >
        <AlertDialog.Container>
          <AlertDialog.Dialog>
            <AlertDialog.Header>
              <AlertDialog.Heading>
                {m.public_templates_delete_heading()}
              </AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body>
              <p>
                {m.public_templates_delete_body({
                  name: deleteTarget?.name ?? "",
                })}
              </p>
            </AlertDialog.Body>
            <AlertDialog.Footer>
              <Button type="button" variant="secondary" slot="close">
                {m.public_templates_cancel()}
              </Button>
              <Button
                type="button"
                variant="danger"
                isPending={state === "deleting"}
                onPress={() =>
                  deleteTarget && void deleteInstallation(deleteTarget)
                }
              >
                {m.public_templates_delete_confirm()}
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </main>
  );
}
