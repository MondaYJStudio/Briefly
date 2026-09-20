import { Alert, Button, Input } from "@heroui/react";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";

import type { Channel } from "../../channels/channels";
import {
  createAdminChannel,
  deleteAdminChannel,
  listAdminChannels,
  updateAdminChannelName,
} from "../../channels/channels-client";
import { m } from "../../paraglide/messages.js";
import { AdminIcon } from "./icons";
import styles from "./articles-view.module.css";
import { SettingsField } from "./fields";

type LoadState = "loading" | "ready" | "error";

function draftNamesFrom(channels: Channel[]): Record<string, string> {
  return Object.fromEntries(
    channels.map((channel) => [channel.id, channel.name]),
  );
}

/**
 * Channel registry: create, rename, delete, and jump to the article list
 * filtered by that Channel — no embedded article browser.
 */
export function ChannelsView() {
  const navigate = useNavigate();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState(false);
  const [actionError, setActionError] = useState<
    "save" | "delete" | "blocked" | null
  >(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [draftNames, setDraftNames] = useState<Record<string, string>>({});

  const reload = useCallback(async () => {
    setLoadState("loading");
    setActionError(null);
    const listed = await listAdminChannels();
    if (!listed) {
      setLoadState("error");
      return;
    }
    setChannels(listed);
    setDraftNames(draftNamesFrom(listed));
    setLoadState("ready");
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function createChannel() {
    setCreating(true);
    setCreateError(false);
    const created = await createAdminChannel({
      name: name.trim(),
      slug: slug.trim(),
    });
    setCreating(false);
    if (!created) {
      setCreateError(true);
      return;
    }
    setName("");
    setSlug("");
    await reload();
  }

  async function saveName(channel: Channel) {
    const nextName = (draftNames[channel.id] ?? channel.name).trim();
    if (nextName === channel.name) return;
    setPendingId(channel.id);
    setActionError(null);
    const updated = await updateAdminChannelName(channel.id, nextName);
    setPendingId(null);
    if (!updated) {
      setActionError("save");
      return;
    }
    await reload();
  }

  async function removeChannel(channel: Channel) {
    setPendingId(channel.id);
    setActionError(null);
    const result = await deleteAdminChannel(channel.id);
    setPendingId(null);
    if (!result.ok) {
      setActionError(result.reason === "blocked" ? "blocked" : "delete");
      return;
    }
    await reload();
  }

  return (
    <main
      className="flex min-w-0 flex-1 flex-col max-w-6xl w-full mx-auto pt-8 px-10 pb-16 max-[860px]:pt-5 max-[860px]:px-4 max-[860px]:pb-12"
      id="admin-main"
    >
      <header className="flex flex-wrap items-end justify-between mb-8 gap-4 max-[860px]:mb-5">
        <div>
          <h1 className={`${styles.pageTitle} text-2xl`}>{m.channels()}</h1>
          <p className={`${styles.pageDesc} mt-2`}>
            {m.channels_page_description()}
          </p>
        </div>
      </header>

      <section className={`${styles.card} mb-6 p-4`}>
        <h2 className="text-base font-medium mb-3">{m.new_channel()}</h2>
        <div className="grid gap-3 max-w-xl">
          <SettingsField label={m.channel_name_label()} htmlFor="channelName">
            <Input
              fullWidth
              id="channelName"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </SettingsField>
          <SettingsField label={m.channel_slug_label()} htmlFor="channelSlug">
            <Input
              fullWidth
              id="channelSlug"
              value={slug}
              onChange={(event) => setSlug(event.target.value)}
            />
            <p className="text-xs faint mt-1">{m.channel_slug_hint()}</p>
          </SettingsField>
          <div>
            <Button
              type="button"
              isPending={creating}
              isDisabled={creating || name.trim() === "" || slug.trim() === ""}
              onPress={() => void createChannel()}
            >
              <AdminIcon name="plus" size={16} />
              {m.create_channel()}
            </Button>
          </div>
        </div>
        {createError ? (
          <Alert status="danger" role="alert" className="mt-4">
            <Alert.Content>
              <Alert.Title>{m.channels_create_failed()}</Alert.Title>
            </Alert.Content>
          </Alert>
        ) : null}
      </section>

      {actionError === "blocked" ? (
        <Alert status="warning" role="alert" className="mb-4">
          <Alert.Content>
            <Alert.Title>{m.channels_delete_blocked()}</Alert.Title>
            <Alert.Description>
              {m.channels_delete_blocked_description()}
            </Alert.Description>
          </Alert.Content>
        </Alert>
      ) : null}
      {actionError === "save" ? (
        <Alert status="danger" role="alert" className="mb-4">
          <Alert.Content>
            <Alert.Title>{m.channels_save_failed()}</Alert.Title>
          </Alert.Content>
        </Alert>
      ) : null}
      {actionError === "delete" ? (
        <Alert status="danger" role="alert" className="mb-4">
          <Alert.Content>
            <Alert.Title>{m.channels_delete_failed()}</Alert.Title>
          </Alert.Content>
        </Alert>
      ) : null}

      {loadState === "loading" ? (
        <p className="faint">{m.channels_page_description()}</p>
      ) : loadState === "error" ? (
        <Alert status="danger" role="alert">
          <Alert.Content>
            <Alert.Title>{m.channels_load_failed()}</Alert.Title>
            <Alert.Description>
              {m.channels_load_failed_description()}
            </Alert.Description>
          </Alert.Content>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            aria-label={m.reload_channels()}
            onPress={() => void reload()}
          >
            {m.retry()}
          </Button>
        </Alert>
      ) : channels.length === 0 ? (
        <div className={styles.card}>
          <div className="p-8 text-center">
            <h2 className="text-lg">{m.channels_empty_title()}</h2>
            <p className={`${styles.pageDesc} mt-2`}>
              {m.channels_empty_description()}
            </p>
          </div>
        </div>
      ) : (
        <ul className="grid gap-3">
          {channels.map((channel) => (
            <li key={channel.id} className={`${styles.card} p-4`}>
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div className="grid gap-2 min-w-[16rem] flex-1">
                  <SettingsField
                    label={m.channel_name_label()}
                    htmlFor={`channel-name-${channel.id}`}
                  >
                    <Input
                      fullWidth
                      id={`channel-name-${channel.id}`}
                      value={draftNames[channel.id] ?? channel.name}
                      onChange={(event) =>
                        setDraftNames((current) => ({
                          ...current,
                          [channel.id]: event.target.value,
                        }))
                      }
                    />
                  </SettingsField>
                  <p className="text-xs faint">
                    {m.channel_slug_label()}: <code>{channel.slug}</code>
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    isPending={pendingId === channel.id}
                    isDisabled={pendingId === channel.id}
                    onPress={() => void saveName(channel)}
                  >
                    {m.channel_save_name()}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onPress={() =>
                      void navigate({
                        to: "/admin/articles",
                        search: { channel: channel.slug },
                      })
                    }
                  >
                    {m.channel_view_articles()}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="danger"
                    isPending={pendingId === channel.id}
                    isDisabled={pendingId === channel.id}
                    onPress={() => void removeChannel(channel)}
                  >
                    {m.channel_delete()}
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
