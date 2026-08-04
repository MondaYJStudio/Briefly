import { createFileRoute } from "@tanstack/react-router";

import { AssetMediaLibrary } from "../../assets/asset-media-library";

export const Route = createFileRoute("/admin/media")({
  component: MediaRoute,
});

function MediaRoute() {
  return (
    <main className="page" id="admin-main">
      <header className="page-head">
        <div>
          <h1 className="page-title">Media</h1>
          <p className="page-desc">
            Images referenced by Drafts and Publications. Files are removed
            through an explicit <strong>cleanup</strong> — never silently.
          </p>
        </div>
      </header>
      <AssetMediaLibrary />
    </main>
  );
}
