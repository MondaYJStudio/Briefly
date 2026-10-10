import type { Channel } from "./channels";
import { getApiClient } from "../routes/api.$";

type ApiResponse<Value = unknown> = {
  status: number;
  data?: Value;
};

/**
 * Read the Administrator Channel registry. Returns null when the request
 * fails so callers can keep a quiet empty UI or surface an error state.
 */
export async function listAdminChannels(): Promise<Channel[] | null> {
  try {
    const response = (await getApiClient().admin.channels.get()) as ApiResponse<{
      channels: Channel[];
    }>;
    if (response.status !== 200 || !response.data) return null;
    return response.data.channels;
  } catch {
    return null;
  }
}

export type CreateAdminChannelResult =
  | { ok: true; channel: Channel }
  | { ok: false; reason: "conflict" | "invalid" | "error" };

export async function createAdminChannel(input: {
  slug: string;
  name: string;
}): Promise<CreateAdminChannelResult> {
  try {
    const response = (await getApiClient().admin.channels.post(
      input,
    )) as ApiResponse<Channel>;
    if (response.status === 201 && response.data) {
      return { ok: true, channel: response.data };
    }
    if (response.status === 409) return { ok: false, reason: "conflict" };
    if (response.status === 400) return { ok: false, reason: "invalid" };
    return { ok: false, reason: "error" };
  } catch {
    return { ok: false, reason: "error" };
  }
}

export async function updateAdminChannelName(
  channelId: string,
  name: string,
): Promise<Channel | null> {
  try {
    const response = (await getApiClient()
      .admin.channels({ channelId })
      .put({ name })) as ApiResponse<Channel>;
    if (response.status !== 200 || !response.data) return null;
    return response.data;
  } catch {
    return null;
  }
}

export type DeleteAdminChannelResult =
  | { ok: true }
  | { ok: false; reason: "blocked" | "error" };

export async function deleteAdminChannel(
  channelId: string,
): Promise<DeleteAdminChannelResult> {
  try {
    const response = (await getApiClient()
      .admin.channels({ channelId })
      .delete()) as ApiResponse;
    if (response.status === 204) return { ok: true };
    if (response.status === 409) return { ok: false, reason: "blocked" };
    return { ok: false, reason: "error" };
  } catch {
    return { ok: false, reason: "error" };
  }
}
