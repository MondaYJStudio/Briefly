import { createFileRoute } from "@tanstack/react-router";

import { AssetMediaLibrary } from "../../assets/asset-media-library";

export const Route = createFileRoute("/admin/media")({
  component: AssetMediaLibrary,
});
