import { createContext, useContext } from "react";

import type { SiteSettings } from "../../site-settings/site-settings";

interface AdminContextValue {
  siteSettings: SiteSettings | null;
}

const AdminContext = createContext<AdminContextValue | null>(null);

export const AdminContextProvider = AdminContext.Provider;

export function useAdminContext(): AdminContextValue {
  const value = useContext(AdminContext);
  if (!value) {
    throw new Error("useAdminContext must be used inside the admin route");
  }
  return value;
}
