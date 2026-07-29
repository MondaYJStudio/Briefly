import { Alert, Button, Form, Input, Label, Spinner } from "@heroui/react";
import { type FormEvent, useEffect, useState } from "react";

import type { Asset } from "./assets";
import { getApiClient } from "../routes/api.$";

type MediaLibraryState =
  "error" | "invalid" | "loading" | "ready" | "uploaded" | "uploading";

export function AssetMediaLibrary() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [state, setState] = useState<MediaLibraryState>("loading");
  const [issues, setIssues] = useState<string[]>([]);
  const selected = assets.find((asset) => asset.id === selectedAssetId) ?? null;

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

  return (
    <section className="space-y-5" aria-labelledby="media-library-heading">
      <div className="space-y-1">
        <h2 id="media-library-heading" className="text-xl font-semibold">
          Media library
        </h2>
        <p className="text-sm text-default-500">
          Upload private verified images or select an existing Asset for reuse.
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
        <ul className="space-y-2" aria-label="Reusable Assets">
          {assets.map((asset) => (
            <li key={asset.id}>
              <Button
                fullWidth
                type="button"
                variant="secondary"
                aria-pressed={selectedAssetId === asset.id}
                onPress={() => setSelectedAssetId(asset.id)}
              >
                {asset.originalFilename} · {asset.width} × {asset.height}
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
          <img
            className="max-h-64 w-full rounded-xl object-contain"
            src={`/media/private/${selected.id}`}
            alt=""
          />
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
            <dd>Private until first successful publication</dd>
          </dl>
        </section>
      ) : null}
    </section>
  );
}
