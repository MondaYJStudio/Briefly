import { Button, Input, Label, Spinner } from "@heroui/react";
import { useId, useState } from "react";

import type { ReadyAsset } from "./assets";
import { AdminIcon } from "../components/admin/icons";
import { StatusChip } from "../components/admin/status-chip";
import { getLocale } from "../paraglide/runtime.js";
import { m } from "../paraglide/messages.js";
import styles from "./verified-asset-picker.module.css";

export type VerifiedAssetPickerState =
  "error" | "loading" | "ready" | "uploaded" | "uploading";

export interface VerifiedAssetPickerProps {
  assets: ReadyAsset[];
  selectedAssetId: string | null;
  state: VerifiedAssetPickerState;
  uploading: boolean;
  onSelect: (asset: ReadyAsset) => void;
  onUpload: (file: File) => Promise<void> | void;
}

/**
 * Shared Library / Upload source for verified Assets used by the editor
 * Cover/Figure picker. Uploads go through the same admin.assets API as Media.
 */
export function VerifiedAssetPicker({
  assets,
  selectedAssetId,
  state,
  uploading,
  onSelect,
  onUpload,
}: VerifiedAssetPickerProps) {
  const baseId = useId();
  const libraryTabId = `${baseId}-library-tab`;
  const uploadTabId = `${baseId}-upload-tab`;
  const libraryPanelId = `${baseId}-library-panel`;
  const uploadPanelId = `${baseId}-upload-panel`;
  const uploadInputId = `${baseId}-upload-input`;
  const [sourceTab, setSourceTab] = useState<"library" | "upload">("library");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const selected = assets.find(({ id }) => id === selectedAssetId) ?? null;
  const locale = getLocale();

  async function submitUpload() {
    if (!uploadFile) return;
    await onUpload(uploadFile);
    setUploadFile(null);
    setSourceTab("library");
  }

  return (
    <div className={styles.panel}>
      <div className={styles.tabs} role="tablist" aria-label={m.image_source()}>
        <button
          className={styles.tab}
          id={libraryTabId}
          type="button"
          role="tab"
          aria-selected={sourceTab === "library"}
          aria-controls={libraryPanelId}
          onClick={() => setSourceTab("library")}
        >
          {m.library()}
        </button>
        <button
          className={styles.tab}
          id={uploadTabId}
          type="button"
          role="tab"
          aria-selected={sourceTab === "upload"}
          aria-controls={uploadPanelId}
          onClick={() => setSourceTab("upload")}
        >
          {m.upload_new()}
        </button>
      </div>

      {sourceTab === "upload" ? (
        <section
          className="space-y-3"
          id={uploadPanelId}
          role="tabpanel"
          aria-labelledby={uploadTabId}
        >
          <Label htmlFor={uploadInputId}>{m.upload_a_verified_image()}</Label>
          <Input
            fullWidth
            id={uploadInputId}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/avif"
            onChange={(event) => setUploadFile(event.target.files?.[0] ?? null)}
          />
          <p className={styles.uploadHint}>{m.upload_format_limit()}</p>
          <Button
            type="button"
            isPending={uploading}
            isDisabled={!uploadFile || uploading}
            onPress={() => void submitUpload()}
          >
            {m.upload_and_select_image()}
          </Button>
        </section>
      ) : (
        <section
          className="space-y-4"
          id={libraryPanelId}
          role="tabpanel"
          aria-labelledby={libraryTabId}
        >
          {state === "loading" ? (
            <p role="status">{m.loading_reusable_assets()}</p>
          ) : assets.length === 0 ? (
            <div className={styles.empty}>
              <AdminIcon name="image" size={24} />
              <p>{m.no_reusable_assets_yet()}</p>
              <Button
                size="sm"
                type="button"
                variant="secondary"
                onPress={() => setSourceTab("upload")}
              >
                {m.upload_your_first_image()}
              </Button>
            </div>
          ) : (
            <ul
              className={styles.grid}
              aria-label={m.assets_available_to_draft()}
            >
              {assets.map((asset) => (
                <li key={asset.id}>
                  <button
                    className={styles.cell}
                    type="button"
                    aria-pressed={asset.id === selectedAssetId}
                    onClick={() => onSelect(asset)}
                  >
                    <span className={styles.thumb}>
                      <img src={`/media/private/${asset.id}`} alt="" />
                    </span>
                    <span className={styles.cellMeta}>
                      <span className={styles.filename}>
                        {asset.originalFilename}
                      </span>
                      <span className={styles.fileMeta}>
                        {m.asset_picker_dimensions({
                          width: asset.width,
                          height: asset.height,
                        })}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {selected ? (
            <div className={styles.summary} aria-label={m.selected_asset()}>
              <img
                className={styles.summaryMini}
                src={`/media/private/${selected.id}`}
                alt=""
              />
              <div className={styles.summaryGrow}>
                <div className={styles.summaryName}>
                  {selected.originalFilename}
                </div>
                <div className={styles.summaryMeta}>
                  {m.asset_picker_summary_meta({
                    format: selected.mimeType
                      .replace("image/", "")
                      .toUpperCase(),
                    width: selected.width,
                    height: selected.height,
                    size: selected.byteSize.toLocaleString(locale),
                  })}
                </div>
              </div>
              <StatusChip variant="primary">{m.selected()}</StatusChip>
            </div>
          ) : null}

          {uploading ? (
            <p role="status" aria-live="polite">
              <Spinner size="sm" /> {m.uploading_and_verifying_image()}
            </p>
          ) : null}
        </section>
      )}
    </div>
  );
}
