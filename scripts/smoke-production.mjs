function requireProductionOrigin(value) {
  if (!value) throw new Error("PRODUCTION_ORIGIN is required");

  let origin;
  try {
    origin = new URL(value);
  } catch {
    throw new Error("PRODUCTION_ORIGIN must be a valid URL");
  }

  if (
    origin.protocol !== "https:" ||
    origin.origin !== value ||
    origin.username ||
    origin.password
  ) {
    throw new Error("PRODUCTION_ORIGIN must be a canonical HTTPS origin");
  }
  return origin;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isCompatibleHealth(payload) {
  return (
    isRecord(payload) &&
    payload.status === "ok" &&
    payload.service === "briefly" &&
    isRecord(payload.schema) &&
    payload.schema.status === "compatible" &&
    isRecord(payload.storage) &&
    payload.storage.d1 === "ready" &&
    payload.storage.r2 === "ready"
  );
}

async function smokeProduction() {
  const origin = requireProductionOrigin(process.env.PRODUCTION_ORIGIN);
  const response = await fetch(new URL("/health", origin), {
    headers: { accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new Error(`Production health probe returned HTTP ${response.status}`);
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error("Production health probe did not return JSON");
  }

  if (!isCompatibleHealth(payload)) {
    throw new Error(
      "Production health probe reported incompatible capabilities",
    );
  }

  console.log("Production health smoke passed.");
}

smokeProduction().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Production health smoke failed",
  );
  process.exitCode = 1;
});
