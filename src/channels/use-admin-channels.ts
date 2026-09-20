import { useEffect, useState } from "react";

import type { Channel } from "./channels";
import { listAdminChannels } from "./channels-client";

/**
 * Load the Channel registry once for Admin pickers and filters. Failures stay
 * quiet: the caller keeps an empty list rather than blocking the page.
 */
export function useAdminChannels(): Channel[] {
  const [channels, setChannels] = useState<Channel[]>([]);

  useEffect(() => {
    let cancelled = false;
    void listAdminChannels().then((listed) => {
      if (!cancelled && listed) setChannels(listed);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return channels;
}
