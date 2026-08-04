import {
  Alert,
  AlertDialog,
  Button,
  Drawer,
  Form,
  Input,
  Label,
  Modal,
  Spinner,
} from "@heroui/react";
import { type FormEvent, useEffect, useState } from "react";

import { assetHasReferences, type AssetLibraryEntry } from "./assets";
import { AdminIcon } from "../components/admin/icons";
import { StatusChip } from "../components/admin/status-chip";
import { getApiClient } from "../routes/api.$";

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
    return "No current Draft or retained Publication references";
  return `${currentDrafts} current Draft${currentDrafts === 1 ? "" : "s"}; ${retainedPublications} retained Publication${retainedPublications === 1 ? "" : "s"}`;
}

interface AssetCleanupPresentation {
  actionLabel: string;
  availability: string;
  cleanupState: string;
  confirmationLabel: string;
  dialogHeading: string;
  showPreview: boolean;
}

function cleanupPresentation(
  asset: AssetLibraryEntry,
): AssetCleanupPresentation {
  if (asset.lifecycleState === "pending_deletion") {
    return {
      actionLabel: "Retry Asset cleanup",
      availability: "Cleanup pending; unavailable for selection or delivery",
      cleanupState: asset.failureCode
        ? "Cleanup failed; retry required"
        : "Deletion pending",
      confirmationLabel: "Confirm cleanup retry",
      dialogHeading: "Retry Asset cleanup?",
      showPreview: false,
    };
  }
  return {
    actionLabel: "Clean up Asset",
    availability: "Ready for authenticated reuse",
    cleanupState: assetHasReferences(asset)
      ? "Blocked while referenced"
      : "Eligible for explicit cleanup",
    confirmationLabel: "Confirm permanent cleanup",
    dialogHeading: "Permanently clean up this Asset?",
    showPreview: true,
  };
}

function assetStatusChip(asset: AssetLibraryEntry) {
  if (asset.lifecycleState === "pending_deletion") {
    return asset.failureCode ? (
      <StatusChip variant="danger" dot>
        Cleanup failed
      </StatusChip>
    ) : (
      <StatusChip variant="warning" dot>
        Awaiting cleanup
      </StatusChip>
    );
  }
  return assetHasReferences(asset) ? (
    <StatusChip variant="primary">In use</StatusChip>
  ) : (
    <StatusChip variant="success" dot>
      Cleanable
    </StatusChip>
  );
}

export function AssetMediaLibrary() {
  const [assets, setAssets] = useState<AssetLibraryEntry[]>([]);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [state, setState] = useState<MediaLibraryState>("loading");
  const [issues, setIssues] = useState<string[]>([]);
  const [uploadOpen, setUploadOpen] = useState(false);
  const selected = assets.find((asset) => asset.id === selectedAssetId) ?? null;
  const selectedIsReferenced = selected ? assetHasReferences(selected) : false;
  const selectedPresentation = selected ? cleanupPresentation(selected) : null;

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

  async function uploadImage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("uploading");
    setIssues([]);
    const form = event.currentTarget;
    const file = new FormData(form).get("assetFile");
    if (!(file instanceof File)) {
      setIssues(["Choose an image to upload."]);
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
    <section aria-label="Media library">
      <div className="alert alert-default mb-4" role="note">
        <AdminIcon name="alert" strokeWidth={1.8} />
        <div className="alert-body">
          <strong>Accepted:</strong> JPEG · PNG · WebP · AVIF — max 8 MiB, max
          8192 px per side, max 8,388,608 px total.{" "}
          <strong>Not accepted:</strong> SVG, GIF, PDF, audio, video, or other
          attachments.
        </div>
        <Button
          className="hide-m"
          size="sm"
          type="button"
          style={{ marginLeft: "auto" }}
          onPress={() => setUploadOpen(true)}
        >
          <AdminIcon name="upload" size={16} />
          Upload image
        </Button>
      </div>

      {state === "error" ? (
        <Alert className="mb-4" status="danger" role="alert">
          <Alert.Content>
            <Alert.Title>Unable to manage Assets</Alert.Title>
            <Alert.Description>
              The upload or media library request failed. Please retry.
            </Alert.Description>
          </Alert.Content>
        </Alert>
      ) : state === "invalid" ? (
        <Alert className="mb-4" status="danger" role="alert">
          <Alert.Content>
            <Alert.Title>Image was not accepted</Alert.Title>
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
        <Alert className="mb-4" status="success" role="status">
          <Alert.Content>
            <Alert.Title>Asset uploaded and selected</Alert.Title>
          </Alert.Content>
        </Alert>
      ) : state === "cleaned" ? (
        <Alert className="mb-4" status="success" role="status">
          <Alert.Content>
            <Alert.Title>Asset cleanup completed</Alert.Title>
            <Alert.Description>
              The media entry and its stored object are no longer available.
            </Alert.Description>
          </Alert.Content>
        </Alert>
      ) : state === "cleanup-blocked" ? (
        <Alert className="mb-4" status="warning" role="alert">
          <Alert.Content>
            <Alert.Title>Asset became referenced</Alert.Title>
            <Alert.Description>
              Cleanup did not begin. Remove every current Draft usage and every
              retained Publication reference before trying again.
            </Alert.Description>
          </Alert.Content>
        </Alert>
      ) : state === "cleanup-failed" ? (
        <Alert className="mb-4" status="danger" role="alert">
          <Alert.Content>
            <Alert.Title>Asset cleanup needs a retry</Alert.Title>
            <Alert.Description>
              The Asset remains visibly pending after a storage failure. Retry
              the explicit cleanup action; do not attach it to new content.
            </Alert.Description>
          </Alert.Content>
        </Alert>
      ) : null}

      {state === "loading" ? (
        <ul className="media-grid" aria-busy="true" role="status">
          {[70, 60, 75, 65].map((width) => (
            <li className="media-cell" key={width} aria-hidden="true">
              <div
                className="skeleton"
                style={{ aspectRatio: "4/3", borderRadius: 0 }}
              />
              <div className="cell-meta">
                <div
                  className="skeleton"
                  style={{ width: `${width}%`, height: "0.75rem" }}
                />
                <div
                  className="skeleton mt-2"
                  style={{ width: "50%", height: "0.7rem" }}
                />
              </div>
            </li>
          ))}
        </ul>
      ) : assets.length === 0 && state !== "error" ? (
        <div className="card">
          <div className="empty">
            <div className="empty-icon">
              <AdminIcon name="image" size={24} />
            </div>
            <h3>No images yet</h3>
            <p>
              Upload your first image here, or straight from the editor when you
              insert a figure.
            </p>
            <div className="empty-actions">
              <Button type="button" onPress={() => setUploadOpen(true)}>
                Upload your first image
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <ul className="media-grid" aria-label="Managed Assets">
          {assets.map((asset) => {
            const presentation = cleanupPresentation(asset);
            const isSelected = selectedAssetId === asset.id;
            return (
              <li key={asset.id}>
                <button
                  className="media-cell"
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => setSelectedAssetId(asset.id)}
                >
                  <span className="thumb">
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
                  <span className="cell-meta">
                    <span className="fname">{asset.originalFilename}</span>
                    <span className="fmeta">
                      {asset.mimeType} · {asset.width} × {asset.height} px
                    </span>
                    <span className="cell-status">
                      {assetStatusChip(asset)}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {/* ===== Upload modal ===== */}
      <Modal.Backdrop isOpen={uploadOpen} onOpenChange={setUploadOpen}>
        <Modal.Container>
          <Modal.Dialog aria-label="Upload image">
            <Modal.Header>
              <div className="briefly-drawer-head">
                <Modal.Heading>Upload image</Modal.Heading>
                <Modal.CloseTrigger aria-label="Close upload dialog" />
              </div>
            </Modal.Header>
            <Form onSubmit={uploadImage}>
              <Modal.Body>
                <div className="dropzone">
                  <AdminIcon name="upload" size={24} />
                  <p
                    className="small"
                    style={{ fontWeight: 600, marginTop: "var(--space-2)" }}
                  >
                    Choose a verified image
                  </p>
                  <p className="small faint">JPEG · PNG · WebP · AVIF</p>
                  <div className="mt-4" style={{ textAlign: "left" }}>
                    <Label htmlFor="assetFile">Upload verified image</Label>
                    <Input
                      className="mt-2"
                      fullWidth
                      id="assetFile"
                      name="assetFile"
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/avif"
                      required
                    />
                  </div>
                </div>
                <div className="alert alert-default mt-4" role="note">
                  <AdminIcon name="alert" strokeWidth={1.8} />
                  <div className="alert-body">
                    Limits: 8 MiB per file · 8192 px per side · 8,388,608 px
                    total. SVG, GIF, PDF, audio, video and other attachments are
                    rejected before upload.
                  </div>
                </div>
              </Modal.Body>
              <Modal.Footer>
                <Button
                  type="button"
                  variant="secondary"
                  onPress={() => setUploadOpen(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" isPending={state === "uploading"}>
                  Upload
                </Button>
              </Modal.Footer>
            </Form>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>

      {/* ===== Asset detail drawer ===== */}
      <Drawer.Backdrop
        isOpen={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedAssetId(null);
        }}
      >
        <Drawer.Content placement="right" className="briefly-drawer-side">
          <Drawer.Dialog aria-label="Asset details">
            <Drawer.Header>
              <div className="briefly-drawer-head">
                <Drawer.Heading>
                  <strong>Asset</strong>
                </Drawer.Heading>
                <Drawer.CloseTrigger aria-label="Close asset details" />
              </div>
            </Drawer.Header>
            <Drawer.Body style={{ padding: "var(--space-4)" }}>
              {selected ? (
                <>
                  <div className="asset-hero">
                    {selectedPresentation?.showPreview ? (
                      <img
                        src={`/media/private/${selected.id}`}
                        alt={`Preview of ${selected.originalFilename}`}
                      />
                    ) : (
                      <div
                        className="empty"
                        style={{ padding: "var(--space-8)" }}
                      >
                        <p className="small muted">
                          Preview unavailable while cleanup is pending
                        </p>
                      </div>
                    )}
                  </div>

                  <dl
                    className="meta-dl"
                    style={{ marginTop: "var(--space-4)" }}
                  >
                    <dt>File</dt>
                    <dd className="mono">{selected.originalFilename}</dd>
                    <dt>Type</dt>
                    <dd>{selected.mimeType}</dd>
                    <dt>Dimensions</dt>
                    <dd>
                      {selected.width} × {selected.height} px
                    </dd>
                    <dt>Size</dt>
                    <dd>{selected.byteSize.toLocaleString()} bytes</dd>
                    <dt>Uploaded</dt>
                    <dd>{new Date(selected.uploadedAt).toLocaleString()}</dd>
                    <dt>Draft refs</dt>
                    <dd>
                      {selected.references.currentDrafts} article
                      {selected.references.currentDrafts === 1 ? "" : "s"}
                    </dd>
                    <dt>Publication refs</dt>
                    <dd>
                      {selected.references.retainedPublications} Publication
                      {selected.references.retainedPublications === 1
                        ? ""
                        : "s"}
                    </dd>
                  </dl>

                  <div className="mt-4">
                    {selected.lifecycleState === "pending_deletion" ? (
                      selected.failureCode ? (
                        <div className="alert alert-danger" role="alert">
                          <AdminIcon name="alert" strokeWidth={2.2} />
                          <div>
                            <div className="alert-title">Cleanup failed</div>
                            <div className="alert-body">
                              References were cleared, but the storage delete
                              call failed. The asset stays listed — retry when
                              storage recovers.
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="alert alert-warning" role="status">
                          <AdminIcon name="clock" strokeWidth={2.2} />
                          <div>
                            <div className="alert-title">Cleanup queued</div>
                            <div className="alert-body">
                              The storage worker is removing the file. This can
                              take a moment on object storage.
                            </div>
                          </div>
                        </div>
                      )
                    ) : selectedIsReferenced ? (
                      <div className="alert alert-default" role="note">
                        <AdminIcon name="alert" strokeWidth={1.8} />
                        <div>
                          <div className="alert-title">
                            Referenced — cleanup is blocked
                          </div>
                          <div className="alert-body">
                            Cleanup is only possible when Draft refs{" "}
                            <strong>and</strong> Publication refs are both zero.{" "}
                            {referenceStatus(selected)}.
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="alert alert-success" role="note">
                        <AdminIcon name="check" strokeWidth={2.2} />
                        <div>
                          <div className="alert-title">No references</div>
                          <div className="alert-body">
                            Zero Draft refs, zero Publication refs. This asset
                            can be cleaned up — the file is removed and cannot
                            be recovered.
                          </div>
                        </div>
                      </div>
                    )}

                    <AlertDialog.Root>
                      <Button
                        className="mt-4"
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
                              <p>
                                This explicit action removes the stored object
                                and media entry. It is allowed only while both
                                reference counts are zero and cannot retract
                                copies that may already have been distributed.
                              </p>
                            </AlertDialog.Body>
                            <AlertDialog.Footer>
                              <Button
                                type="button"
                                variant="secondary"
                                slot="close"
                              >
                                Cancel
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

                  <hr
                    className="divider"
                    style={{ margin: "var(--space-5) 0" }}
                  />
                  <p className="small faint">
                    Alt text and captions are <strong>not</strong> stored on the
                    asset — they are set per use, wherever the image is
                    inserted.
                  </p>
                </>
              ) : null}
            </Drawer.Body>
          </Drawer.Dialog>
        </Drawer.Content>
      </Drawer.Backdrop>
    </section>
  );
}
