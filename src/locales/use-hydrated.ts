import { useEffect, useState } from "react";

/**
 * SSR controls paint before their client event handlers are attached. Keep
 * locale controls disabled for that short window so an eager interaction
 * cannot be lost between the first paint and hydration.
 */
export function useHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

  return hydrated;
}
