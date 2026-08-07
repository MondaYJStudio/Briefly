import { createFileRoute } from "@tanstack/react-router";

import { PublicTemplatesAdmin } from "../../public-templates/public-templates-admin";

export const Route = createFileRoute("/admin/public-templates")({
  component: PublicTemplatesAdmin,
});
