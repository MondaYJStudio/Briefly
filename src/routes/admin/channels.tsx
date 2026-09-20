import { createFileRoute } from "@tanstack/react-router";

import { ChannelsView } from "../../components/admin/channels-view";

export const Route = createFileRoute("/admin/channels")({
  component: ChannelsView,
});
