import { Alert, AlertDialog, Button, Drawer, Form, Modal } from "@heroui/react";
import {
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
  useEffect,
  useRef,
  useState,
} from "react";

import { assetHasReferences, type AssetLibraryEntry } from "./assets";
import { AdminIcon } from "../components/admin/icons";
import { StatusChip } from "../components/admin/status-chip";
import { getLocale } from "../paraglide/runtime.js";
import { m } from "../paraglide/messages.js";
import { getApiClient } from "../routes/api.$";
import styles from "./asset-media-library.module.css";

type MediaLibraryState =
  | "cleanup-blocked"
  | "cleanup-failed"
  | "cleaned"
  | "cleaning"
  | "error"
  | "invalid"
  | "loading"
  | "ready"
  | "uploaded"
  | "uploading";

function referenceStatus(asset: AssetLibraryEntry): string {
  const { currentDrafts, retainedPublications } = asset.references;
  if (currentDrafts === 0 && retainedPublications === 0)
    return m.asset_reference_status_none();
  const drafts =
    currentDrafts === 1
      ? m.asset_reference_drafts_one({ count: currentDrafts })
      : m.asset_reference_drafts_other({ count: currentDrafts });
  const publications =
    retainedPublications === 1
      ? m.asset_reference_publications_one({ count: retainedPublications })
      : m.asset_reference_publications_other({ count: retainedPublications });
  return m.asset_reference_status({ drafts, publications });
}

interface AssetCleanupPresentation {
  actionLabel: string;
  confirmationLabel: string;
  dialogHeading: string;
  showPreview: boolean;
}

function cleanupPresentation(
  asset: AssetLibraryEntry,
): AssetCleanupPresentation {
  if (asset.lifecycleState === "pending_deletion") {
    return {
      actionLabel: m.retry_asset_cleanup(),
      confirmationLabel: m.confirm_cleanup_retry(),
      dialogHeading: m.retry_asset_cleanup_question(),
      showPreview: false,
    };
  }
  return {
    actionLabel: m.clean_up_asset(),
    confirmationLabel: m.confirm_permanent_cleanup(),
    dialogHeading: m.permanently_clean_up_asset_question(),
    showPreview: true,
  };
}

function assetStatusChip(asset: AssetLibraryEntry) {
  if (asset.lifecycleState === "pending_deletion") {
    return asset.failureCode ? (
      <StatusChip variant="danger" dot>
        {m.status_cleanup_failed()}
      </StatusChip>
    ) : (
      <StatusChip variant="warning" dot>
        {m.status_awaiting_cleanup()}
      </StatusChip>
    );
  }
  return assetHasReferences(asset) ? (
    <StatusChip variant="primary">{m.status_in_use()}</StatusChip>
  ) : (
    <StatusChip variant="success" dot>
      {m.status_cleanable()}
    </StatusChip>
  );
}

/**
 * Media workspace: localized Asset grid, upload modal, and cleanup detail drawer.
 */
export function AssetMediaLibrary() {
  const [assets, setAssets] = useState<AssetLibraryEntry[]>([]);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [state, setState] = useState<MediaLibraryState>("loading");
  const [issues, setIssues] = useState<string[]>([]);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadFile, setUploadFileState] = useState<File | null>(null);
  const [uploadPreviewUrl, setUploadPreviewUrl] = useState<string | null>(null);
  const [uploadDragging, setUploadDragging] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const lastFocusRef = useRef<HTMLElement | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const locale = getLocale();
  const selected = assets.find((asset) => asset.id === selectedAssetId) ?? null;
  const selectedIsReferenced = selected ? assetHasReferences(selected) : false;
  const selectedPresentation = selected ? cleanupPresentation(selected) : null;
  const uploadFileName = uploadFile?.name ?? null;

  useEffect(() => {
    if (!uploadFile) {
      setUploadPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(uploadFile);
    setUploadPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [uploadFile]);

  useEffect(() => {
    if (!selected) setLightboxOpen(false);
  }, [selected]);

  useEffect(() => {
    let active = true;
    void getApiClient()
      .admin.assets.get()
      .then((response) => {
        if (response.status !== 200 || !response.data)
          throw new Error("Assets unavailable");
        if (active) {
          setAssets(response.data.assets);
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

  async function refreshAssets(): Promise<void> {
    const response = await getApiClient().admin.assets.get();
    if (response.status !== 200 || !response.data)
      throw new Error("Assets unavailable");
    setAssets(response.data.assets);
  }

  function syncUploadInput(file: File | null) {
    const input = uploadInputRef.current;
    if (!input) return;
    if (!file) {
      input.value = "";
      return;
    }
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
  }

  function clearUploadSelection() {
    setUploadFileState(null);
    syncUploadInput(null);
  }

  function openUpload() {
    setUploadOpen(true);
  }

  function handleUploadOpenChange(open: boolean) {
    setUploadOpen(open);
    if (!open) {
      clearUploadSelection();
      setUploadDragging(false);
    }
  }

  function setUploadFile(file: File | null) {
    setUploadFileState(file);
    syncUploadInput(file);
  }

  function onUploadInputChange(event: ChangeEvent<HTMLInputElement>) {
    setUploadFileState(event.target.files?.[0] ?? null);
  }

  function onUploadDragEnter(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setUploadDragging(true);
  }

  function onUploadDragOver(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
  }

  function onUploadDragLeave(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setUploadDragging(false);
  }

  function onUploadDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setUploadDragging(false);
    const file = event.dataTransfer.files?.[0] ?? null;
    if (file) setUploadFile(file);
  }

  function selectAsset(assetId: string, trigger: HTMLElement) {
    lastFocusRef.current = trigger;
    setSelectedAssetId(assetId);
  }

  function closeDetails(open: boolean) {
    if (open) return;
    setSelectedAssetId(null);
    queueMicrotask(() => lastFocusRef.current?.focus());
  }

  async function uploadImage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("uploading");
    setIssues([]);
    const form = event.currentTarget;
    const file = new FormData(form).get("assetFile");
    if (!(file instanceof File)) {
      setIssues([m.choose_image_to_upload()]);
      setState("invalid");
      return;
    }

    try {
      const response = await getApiClient().admin.assets.post({ file });
      if (response.status === 201 && response.data) {
        setAssets((current) => [response.data, ...current]);
        setSelectedAssetId(response.data.id);
        setState("uploaded");
        setUploadOpen(false);
        clearUploadSelection();
        form.reset();
        return;
      }

      const error = response.error?.value;
      if (error && "issues" in error) {
        setIssues(error.issues.map((issue) => issue.message));
        setState("invalid");
      } else {
        setState("error");
      }
    } catch {
      setState("error");
    }
  }

  async function cleanUpSelectedAsset() {
    if (!selected || selectedIsReferenced) return;
    const assetId = selected.id;
    setState("cleaning");
    try {
      const response = await getApiClient().admin.assets({ assetId }).delete();
      if (response.status === 204) {
        setAssets((current) => current.filter(({ id }) => id !== assetId));
        setSelectedAssetId(null);
        setState("cleaned");
        return;
      }

      await refreshAssets();
      setState(response.status === 409 ? "cleanup-blocked" : "cleanup-failed");
    } catch {
      try {
        await refreshAssets();
      } catch {}
      setState("cleanup-failed");
    }
  }

  return (
    <main className={styles.page} id="admin-main">
      <header className={styles.pageHead}>
        <div>
          <h1 className={styles.pageTitle}>{m.media()}</h1>
          <p className={styles.pageDesc}>{m.media_page_description()}</p>
        </div>
        <div className={styles.pageActions}>
          <Button type="button" onPress={openUpload}>
            <AdminIcon name="upload" size={16} />
            {m.upload_image()}
          </Button>
        </div>
      </header>

      <section aria-label={m.media_library()}>
        <div className={styles.rules} role="note">
          <AdminIcon name="alert" strokeWidth={1.8} />
          <div className={styles.rulesBody}>
            <strong>{m.media_accepted_label()}</strong>{" "}
            {m.media_accepted_rules()}{" "}
            <strong>{m.media_not_accepted_label()}</strong>{" "}
            {m.media_not_accepted_rules()}
          </div>
        </div>

        {state === "error" ? (
          <Alert className={styles.feedback} status="danger" role="alert">
            <Alert.Content>
              <Alert.Title>{m.unable_to_manage_assets()}</Alert.Title>
              <Alert.Description>
                {m.unable_to_manage_assets_description()}
              </Alert.Description>
            </Alert.Content>
          </Alert>
        ) : state === "uploading" ? (
          <Alert className={styles.feedback} status="default" role="status">
            <Alert.Content>
              <Alert.Title>{m.uploading_and_verifying_image()}</Alert.Title>
            </Alert.Content>
          </Alert>
        ) : state === "invalid" ? (
          <Alert className={styles.feedback} status="danger" role="alert">
            <Alert.Content>
              <Alert.Title>{m.image_not_accepted()}</Alert.Title>
              <Alert.Description>
                <ul className="list-disc pl-5">
                  {issues.map((issue) => (
                    <li key={issue}>{issue}</li>
                  ))}
                </ul>
              </Alert.Description>
            </Alert.Content>
          </Alert>
        ) : state === "uploaded" ? (
          <Alert className={styles.feedback} status="success" role="status">
            <Alert.Content>
              <Alert.Title>{m.asset_uploaded_and_selected()}</Alert.Title>
            </Alert.Content>
          </Alert>
        ) : state === "cleaned" ? (
          <Alert className={styles.feedback} status="success" role="status">
            <Alert.Content>
              <Alert.Title>{m.asset_cleanup_completed()}</Alert.Title>
              <Alert.Description>
                {m.asset_cleanup_completed_description()}
              </Alert.Description>
            </Alert.Content>
          </Alert>
        ) : state === "cleanup-blocked" ? (
          <Alert className={styles.feedback} status="warning" role="alert">
            <Alert.Content>
              <Alert.Title>{m.asset_became_referenced()}</Alert.Title>
              <Alert.Description>
                {m.asset_became_referenced_description()}
              </Alert.Description>
            </Alert.Content>
          </Alert>
        ) : state === "cleanup-failed" ? (
          <Alert className={styles.feedback} status="danger" role="alert">
            <Alert.Content>
              <Alert.Title>{m.asset_cleanup_needs_retry()}</Alert.Title>
              <Alert.Description>
                {m.asset_cleanup_needs_retry_description()}
              </Alert.Description>
            </Alert.Content>
          </Alert>
        ) : null}

        {state === "loading" ? (
          <ul className={styles.grid} aria-busy="true" role="status">
            {[70, 60, 75, 65].map((width) => (
              <li key={width} aria-hidden="true">
                <div className={styles.cell}>
                  <div
                    className={`${styles.skeleton} ${styles.skeletonThumb}`}
                  />
                  <div className={styles.cellMeta}>
                    <div
                      className={styles.skeleton}
                      style={{ width: `${width}%`, height: "0.75rem" }}
                    />
                    <div
                      className={`${styles.skeleton} ${styles.skeletonGap}`}
                      style={{ width: "50%", height: "0.7rem" }}
                    />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : assets.length === 0 && state !== "error" ? (
          <div className={styles.card}>
            <div className={styles.empty}>
              <div className={styles.emptyIcon}>
                <AdminIcon name="image" size={24} />
              </div>
              <h3>{m.no_images_yet()}</h3>
              <p>{m.no_images_yet_description()}</p>
              <div className={styles.emptyActions}>
                <Button type="button" onPress={openUpload}>
                  {m.upload_your_first_image()}
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <ul className={styles.grid} aria-label={m.managed_assets()}>
            {assets.map((asset) => {
              const presentation = cleanupPresentation(asset);
              const isSelected = selectedAssetId === asset.id;
              return (
                <li key={asset.id}>
                  <button
                    className={styles.cell}
                    type="button"
                    aria-pressed={isSelected}
                    onClick={(event) =>
                      selectAsset(asset.id, event.currentTarget)
                    }
                  >
                    <span className={styles.thumb}>
                      {presentation.showPreview ? (
                        <img
                          src={`/media/private/${asset.id}`}
                          alt=""
                          loading="lazy"
                        />
                      ) : (
                        <AdminIcon name="image" size={24} />
                      )}
                    </span>
                    <span className={styles.cellMeta}>
                      <span className={styles.filename}>
                        {asset.originalFilename}
                      </span>
                      <span className={styles.fileMeta}>
                        {m.asset_grid_meta({
                          mimeType: asset.mimeType,
                          width: asset.width,
                          height: asset.height,
                        })}
                      </span>
                      <span className={styles.cellStatus}>
                        {assetStatusChip(asset)}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <Modal.Backdrop
          isOpen={uploadOpen}
          onOpenChange={handleUploadOpenChange}
        >
          <Modal.Container>
            <Modal.Dialog aria-label={m.upload_image()}>
              <Modal.Header>
                <div className="briefly-drawer-head">
                  <Modal.Heading>{m.upload_image()}</Modal.Heading>
                  <Modal.CloseTrigger aria-label={m.close_upload_dialog()} />
                </div>
              </Modal.Header>
              <Form onSubmit={uploadImage}>
                <Modal.Body>
                  <label
                    className={`${styles.dropzone}${uploadDragging ? ` ${styles.dropzoneActive}` : ""}`}
                    htmlFor="assetFile"
                    onDragEnter={onUploadDragEnter}
                    onDragOver={onUploadDragOver}
                    onDragLeave={onUploadDragLeave}
                    onDrop={onUploadDrop}
                  >
                    {uploadPreviewUrl ? (
                      <>
                        <div className={styles.dropzonePreview}>
                          <img
                            src={uploadPreviewUrl}
                            alt={m.selected_upload_preview()}
                          />
                        </div>
                        {uploadFileName ? (
                          <p className={styles.dropzoneFile}>
                            {uploadFileName}
                          </p>
                        ) : null}
                        <p className={styles.dropzoneHint}>
                          {m.choose_verified_image()}
                        </p>
                      </>
                    ) : (
                      <>
                        <AdminIcon name="upload" size={24} />
                        <p className={styles.dropzoneTitle}>
                          {m.choose_verified_image()}
                        </p>
                        <p className={styles.dropzoneHint}>
                          {m.accepted_image_formats_short()}
                        </p>
                      </>
                    )}
                    <input
                      ref={uploadInputRef}
                      className={styles.dropzoneInput}
                      id="assetFile"
                      name="assetFile"
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/avif"
                      required
                      aria-label={m.upload_verified_image()}
                      onChange={onUploadInputChange}
                    />
                  </label>
                  <div className={styles.uploadLimits} role="note">
                    <AdminIcon name="alert" strokeWidth={1.8} />
                    <div>{m.upload_limits_note()}</div>
                  </div>
                </Modal.Body>
                <Modal.Footer>
                  <Button
                    type="button"
                    variant="secondary"
                    onPress={() => handleUploadOpenChange(false)}
                  >
                    {m.cancel()}
                  </Button>
                  <Button type="submit" isPending={state === "uploading"}>
                    {m.upload()}
                  </Button>
                </Modal.Footer>
              </Form>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>

        <Drawer.Backdrop isOpen={selected !== null} onOpenChange={closeDetails}>
          <Drawer.Content placement="right" className="briefly-drawer-side">
            <Drawer.Dialog aria-label={m.asset_details()}>
              <Drawer.Header>
                <div className="briefly-drawer-head">
                  <Drawer.Heading>
                    <strong>{m.asset()}</strong>
                  </Drawer.Heading>
                  <Drawer.CloseTrigger aria-label={m.close_asset_details()} />
                </div>
              </Drawer.Header>
              <Drawer.Body className={styles.drawerBody}>
                {selected ? (
                  <>
                    {selectedPresentation?.showPreview ? (
                      <button
                        type="button"
                        className={`${styles.hero} ${styles.heroPreview}`}
                        aria-label={m.open_full_image_preview({
                          filename: selected.originalFilename,
                        })}
                        onClick={() => setLightboxOpen(true)}
                      >
                        <img
                          src={`/media/private/${selected.id}`}
                          alt={m.preview_of_filename({
                            filename: selected.originalFilename,
                          })}
                        />
                      </button>
                    ) : (
                      <div className={`${styles.hero} ${styles.heroEmpty}`}>
                        <p>{m.preview_unavailable_cleanup_pending()}</p>
                      </div>
                    )}

                    <dl className={styles.metaDl}>
                      <dt>{m.meta_file()}</dt>
                      <dd className={styles.mono}>
                        {selected.originalFilename}
                      </dd>
                      <dt>{m.meta_type()}</dt>
                      <dd>{selected.mimeType}</dd>
                      <dt>{m.meta_dimensions()}</dt>
                      <dd>
                        {m.asset_dimensions({
                          width: selected.width,
                          height: selected.height,
                        })}
                      </dd>
                      <dt>{m.meta_size()}</dt>
                      <dd>
                        {m.size_bytes({
                          size: selected.byteSize.toLocaleString(locale),
                        })}
                      </dd>
                      <dt>{m.meta_uploaded()}</dt>
                      <dd>
                        {new Date(selected.uploadedAt).toLocaleString(locale)}
                      </dd>
                      <dt>{m.meta_draft_refs()}</dt>
                      <dd>
                        {selected.references.currentDrafts === 1
                          ? m.draft_refs_one({
                              count: selected.references.currentDrafts,
                            })
                          : m.draft_refs_other({
                              count: selected.references.currentDrafts,
                            })}
                      </dd>
                      <dt>{m.meta_publication_refs()}</dt>
                      <dd>
                        {selected.references.retainedPublications === 1
                          ? m.publication_refs_one({
                              count: selected.references.retainedPublications,
                            })
                          : m.publication_refs_other({
                              count: selected.references.retainedPublications,
                            })}
                      </dd>
                    </dl>

                    <div>
                      {selected.lifecycleState === "pending_deletion" ? (
                        selected.failureCode ? (
                          <div
                            className={`${styles.detailAlert} ${styles.detailAlertDanger}`}
                            role="alert"
                          >
                            <AdminIcon name="alert" strokeWidth={2.2} />
                            <div>
                              <div className={styles.detailAlertTitle}>
                                {m.cleanup_failed_title()}
                              </div>
                              <div>{m.cleanup_failed_body()}</div>
                            </div>
                          </div>
                        ) : (
                          <div
                            className={`${styles.detailAlert} ${styles.detailAlertWarning}`}
                            role="status"
                          >
                            <AdminIcon name="clock" strokeWidth={2.2} />
                            <div>
                              <div className={styles.detailAlertTitle}>
                                {m.cleanup_queued_title()}
                              </div>
                              <div>{m.cleanup_queued_body()}</div>
                            </div>
                          </div>
                        )
                      ) : selectedIsReferenced ? (
                        <div className={styles.detailAlert} role="note">
                          <AdminIcon name="alert" strokeWidth={1.8} />
                          <div>
                            <div className={styles.detailAlertTitle}>
                              {m.referenced_cleanup_blocked_title()}
                            </div>
                            <div>
                              {m.referenced_cleanup_blocked_body({
                                referenceStatus: referenceStatus(selected),
                              })}
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div
                          className={`${styles.detailAlert} ${styles.detailAlertSuccess}`}
                          role="note"
                        >
                          <AdminIcon name="check" strokeWidth={2.2} />
                          <div>
                            <div className={styles.detailAlertTitle}>
                              {m.no_references_title()}
                            </div>
                            <div>{m.no_references_body()}</div>
                          </div>
                        </div>
                      )}

                      <AlertDialog.Root>
                        <Button
                          className={styles.cleanupAction}
                          fullWidth
                          type="button"
                          variant="danger-soft"
                          isDisabled={selectedIsReferenced}
                          isPending={state === "cleaning"}
                        >
                          {selectedPresentation?.actionLabel}
                        </Button>
                        <AlertDialog.Backdrop>
                          <AlertDialog.Container>
                            <AlertDialog.Dialog>
                              <AlertDialog.Header>
                                <AlertDialog.Heading>
                                  {selectedPresentation?.dialogHeading}
                                </AlertDialog.Heading>
                              </AlertDialog.Header>
                              <AlertDialog.Body>
                                <p>{m.cleanup_confirmation_body()}</p>
                              </AlertDialog.Body>
                              <AlertDialog.Footer>
                                <Button
                                  type="button"
                                  variant="secondary"
                                  slot="close"
                                >
                                  {m.cancel()}
                                </Button>
                                <Button
                                  type="button"
                                  variant="danger-soft"
                                  slot="close"
                                  isDisabled={
                                    selectedIsReferenced || state === "cleaning"
                                  }
                                  onPress={() => void cleanUpSelectedAsset()}
                                >
                                  {selectedPresentation?.confirmationLabel}
                                </Button>
                              </AlertDialog.Footer>
                            </AlertDialog.Dialog>
                          </AlertDialog.Container>
                        </AlertDialog.Backdrop>
                      </AlertDialog.Root>
                    </div>

                    <hr className={styles.divider} />
                    <p className={styles.footnote}>
                      {m.alt_not_stored_on_asset()}
                    </p>
                  </>
                ) : null}
              </Drawer.Body>
            </Drawer.Dialog>
          </Drawer.Content>
        </Drawer.Backdrop>

        <Modal.Backdrop
          className={styles.galleryBackdrop}
          isOpen={lightboxOpen && selected !== null}
          onOpenChange={setLightboxOpen}
        >
          <Modal.Container
            className={styles.galleryContainer}
            placement="center"
          >
            <Modal.Dialog
              className={styles.galleryDialog}
              aria-label={
                selected
                  ? m.preview_of_filename({
                      filename: selected.originalFilename,
                    })
                  : m.asset_details()
              }
            >
              <Modal.CloseTrigger
                className={styles.galleryClose}
                aria-label={m.close_full_image_preview()}
              />
              <div className={styles.galleryStage}>
                {selected && selectedPresentation?.showPreview ? (
                  <img
                    className={styles.galleryImage}
                    src={`/media/private/${selected.id}`}
                    alt={m.preview_of_filename({
                      filename: selected.originalFilename,
                    })}
                  />
                ) : null}
              </div>
              {selected ? (
                <footer className={styles.galleryCaption}>
                  <div className={styles.galleryFilename}>
                    {selected.originalFilename}
                  </div>
                  <div className={styles.galleryMeta}>
                    {m.asset_picker_summary_meta({
                      format: selected.mimeType
                        .replace("image/", "")
                        .toUpperCase(),
                      width: selected.width,
                      height: selected.height,
                      size: selected.byteSize.toLocaleString(locale),
                    })}
                  </div>
                  <p className={styles.galleryHint}>{m.gallery_close_hint()}</p>
                </footer>
              ) : null}
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </section>
    </main>
  );
}
