import {
  Alert,
  AlertDialog,
  Button,
  Form,
  Input,
  Label,
  Spinner,
} from "@heroui/react";
import { type FormEvent, useEffect, useState } from "react";

import { assetHasReferences, type AssetLibraryEntry } from "./assets";
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
  listStatus: string;
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
      listStatus: "cleanup pending",
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
    listStatus: referenceStatus(asset),
    showPreview: true,
  };
}

export function AssetMediaLibrary() {
  const [assets, setAssets] = useState<AssetLibraryEntry[]>([]);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [state, setState] = useState<MediaLibraryState>("loading");
  const [issues, setIssues] = useState<string[]>([]);
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
    <section className="space-y-5" aria-labelledby="media-library-heading">
      <div className="space-y-1">
        <h2 id="media-library-heading" className="text-xl font-semibold">
          Media library
        </h2>
        <p className="text-sm text-default-500">
          Upload private verified images or select an existing Asset for reuse.
        </p>
        <p className="text-sm text-default-500">
          Asset cleanup is always explicit. Only Assets with zero current Draft
          and retained Publication references can be removed; there are no
          folders, bulk cleanup, or automatic age rules.
        </p>
      </div>
      {state === "error" ? (
        <Alert status="danger" role="alert">
          <Alert.Content>
            <Alert.Title>Unable to manage Assets</Alert.Title>
            <Alert.Description>
              The upload or media library request failed. Please retry.
            </Alert.Description>
          </Alert.Content>
        </Alert>
      ) : state === "invalid" ? (
        <Alert status="danger" role="alert">
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
        <Alert status="success" role="status">
          <Alert.Content>
            <Alert.Title>Asset uploaded and selected</Alert.Title>
          </Alert.Content>
        </Alert>
      ) : state === "cleaned" ? (
        <Alert status="success" role="status">
          <Alert.Content>
            <Alert.Title>Asset cleanup completed</Alert.Title>
            <Alert.Description>
              The media entry and its stored object are no longer available.
            </Alert.Description>
          </Alert.Content>
        </Alert>
      ) : state === "cleanup-blocked" ? (
        <Alert status="warning" role="alert">
          <Alert.Content>
            <Alert.Title>Asset became referenced</Alert.Title>
            <Alert.Description>
              Cleanup did not begin. Remove every current Draft usage and every
              retained Publication reference before trying again.
            </Alert.Description>
          </Alert.Content>
        </Alert>
      ) : state === "cleanup-failed" ? (
        <Alert status="danger" role="alert">
          <Alert.Content>
            <Alert.Title>Asset cleanup needs a retry</Alert.Title>
            <Alert.Description>
              The Asset remains visibly pending after a storage failure. Retry
              the explicit cleanup action; do not attach it to new content.
            </Alert.Description>
          </Alert.Content>
        </Alert>
      ) : null}
      <Form className="space-y-3" onSubmit={uploadImage}>
        <div className="w-full space-y-2">
          <Label htmlFor="assetFile">Upload verified image</Label>
          <Input
            fullWidth
            id="assetFile"
            name="assetFile"
            type="file"
            accept="image/jpeg,image/png,image/webp,image/avif"
            required
          />
        </div>
        <p className="text-sm text-default-500">
          JPEG, PNG, WebP, or AVIF up to 8 MiB; maximum 8192 px per side and
          8,388,608 pixels total.
        </p>
        <Button fullWidth type="submit" isPending={state === "uploading"}>
          Upload image
        </Button>
      </Form>
      {state === "loading" ? (
        <div className="flex items-center gap-3" role="status">
          <Spinner aria-label="Loading Assets" />
          <span>Loading Assets…</span>
        </div>
      ) : assets.length === 0 ? (
        <p className="text-sm text-default-500">No reusable Assets yet.</p>
      ) : (
        <ul className="space-y-2" aria-label="Managed Assets">
          {assets.map((asset) => (
            <li key={asset.id}>
              <Button
                fullWidth
                type="button"
                variant="secondary"
                aria-pressed={selectedAssetId === asset.id}
                onPress={() => setSelectedAssetId(asset.id)}
              >
                {asset.originalFilename} · {asset.width} × {asset.height} ·{" "}
                {cleanupPresentation(asset).listStatus}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {selected ? (
        <section
          className="space-y-3"
          aria-labelledby="selected-asset-heading"
          aria-live="polite"
        >
          <h3 id="selected-asset-heading" className="font-semibold">
            Selected Asset
          </h3>
          {selectedPresentation?.showPreview ? (
            <img
              className="max-h-64 w-full rounded-xl object-contain"
              src={`/media/private/${selected.id}`}
              alt=""
            />
          ) : null}
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="font-medium">Filename</dt>
            <dd className="break-all">{selected.originalFilename}</dd>
            <dt className="font-medium">MIME</dt>
            <dd>{selected.mimeType}</dd>
            <dt className="font-medium">Dimensions</dt>
            <dd>
              {selected.width} × {selected.height} px
            </dd>
            <dt className="font-medium">Bytes</dt>
            <dd>{selected.byteSize.toLocaleString()}</dd>
            <dt className="font-medium">Uploaded</dt>
            <dd>{new Date(selected.uploadedAt).toLocaleString()}</dd>
            <dt className="font-medium">Availability</dt>
            <dd>{selectedPresentation?.availability}</dd>
            <dt className="font-medium">Reference status</dt>
            <dd>{referenceStatus(selected)}</dd>
            <dt className="font-medium">Cleanup state</dt>
            <dd>{selectedPresentation?.cleanupState}</dd>
          </dl>
          {selectedIsReferenced ? (
            <p className="text-sm text-default-500">
              Cleanup is disabled. Remove this Asset from all current Drafts;
              retained Publications continue protecting it until their Article
              history is permanently purged.
            </p>
          ) : null}
          <AlertDialog.Root>
            <Button
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
                      This explicit action removes the stored object and media
                      entry. It is allowed only while both reference counts are
                      zero and cannot retract copies that may already have been
                      distributed.
                    </p>
                  </AlertDialog.Body>
                  <AlertDialog.Footer>
                    <Button type="button" variant="secondary" slot="close">
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      variant="danger-soft"
                      slot="close"
                      isDisabled={selectedIsReferenced || state === "cleaning"}
                      onPress={() => void cleanUpSelectedAsset()}
                    >
                      {selectedPresentation?.confirmationLabel}
                    </Button>
                  </AlertDialog.Footer>
                </AlertDialog.Dialog>
              </AlertDialog.Container>
            </AlertDialog.Backdrop>
          </AlertDialog.Root>
        </section>
      ) : null}
    </section>
  );
}
