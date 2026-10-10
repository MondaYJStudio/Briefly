import { Alert, AlertDialog, Button, Dropdown, Input, Modal } from "@heroui/react";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  CHANNEL_NAME_MAXIMUM_LENGTH,
  CHANNEL_SLUG_MAXIMUM_LENGTH,
  type Channel,
} from "../../channels/channels";
import { channelIntegrationPrompt } from "../../channels/channel-prompt";
import {
  createAdminChannel,
  deleteAdminChannel,
  listAdminChannels,
  updateAdminChannelName,
} from "../../channels/channels-client";
import { m } from "../../paraglide/messages.js";
import { getLocale } from "../../paraglide/runtime.js";
import styles from "./channels-view.module.css";
import { SettingsField } from "./fields";
import { AdminIcon } from "./icons";

type LoadState = "loading" | "ready" | "error";
type CreateError = "conflict" | "invalid" | "error" | null;

/**
 * Suggest a slug from an ASCII-ish display name. Names without Latin letters
 * or digits (for example Chinese) yield "" so the Administrator types one.
 */
function suggestSlug(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, CHANNEL_SLUG_MAXIMUM_LENGTH);
}

function formatCreatedAt(createdAt: string): string {
  return new Date(createdAt).toLocaleDateString(getLocale(), {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * Channel registry: create, rename, delete, and jump to the article list
 * filtered by that Channel — no embedded article browser.
 */
export function ChannelsView() {
  const navigate = useNavigate();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [createOpen, setCreateOpen] = useState(false);
  const [actionError, setActionError] = useState<
    "save" | "delete" | "blocked" | null
  >(null);
  const [promptChannel, setPromptChannel] = useState<Channel | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Channel | null>(null);

  const reload = useCallback(async () => {
    setLoadState("loading");
    const listed = await listAdminChannels();
    if (!listed) {
      setLoadState("error");
      return;
    }
    setChannels(listed);
    setLoadState("ready");
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function saveName(channel: Channel, draft: string) {
    const nextName = draft.trim();
    if (nextName === "" || nextName === channel.name) {
      setRenamingId(null);
      return;
    }
    setPendingId(channel.id);
    setActionError(null);
    const updated = await updateAdminChannelName(channel.id, nextName);
    setPendingId(null);
    if (!updated) {
      setActionError("save");
      return;
    }
    setRenamingId(null);
    setChannels((current) =>
      current.map((item) => (item.id === updated.id ? updated : item)),
    );
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
    setChannels((current) => current.filter((item) => item.id !== channel.id));
  }

  function viewArticles(channel: Channel) {
    void navigate({
      to: "/admin/articles",
      search: { channel: channel.slug },
    });
  }

  const createButton = (
    <Button type="button" onPress={() => setCreateOpen(true)}>
      <AdminIcon name="plus" size={16} />
      {m.new_channel()}
    </Button>
  );

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
        {loadState === "ready" && channels.length > 0 ? createButton : null}
      </header>

      <div className="flex flex-col gap-4">
        {actionError === "blocked" ? (
          <Alert status="warning" role="alert">
            <Alert.Content>
              <Alert.Title>{m.channels_delete_blocked()}</Alert.Title>
              <Alert.Description>
                {m.channels_delete_blocked_description()}
              </Alert.Description>
            </Alert.Content>
          </Alert>
        ) : actionError === "save" ? (
          <Alert status="danger" role="alert">
            <Alert.Content>
              <Alert.Title>{m.channels_save_failed()}</Alert.Title>
            </Alert.Content>
          </Alert>
        ) : actionError === "delete" ? (
          <Alert status="danger" role="alert">
            <Alert.Content>
              <Alert.Title>{m.channels_delete_failed()}</Alert.Title>
            </Alert.Content>
          </Alert>
        ) : null}

        {loadState === "loading" ? (
          <ChannelListSkeleton />
        ) : loadState === "error" ? (
          <div className={styles.card}>
            <div className="flex flex-col items-center text-center py-16 px-6">
              <div
                className={`${styles.emptyIcon} ${styles.emptyIconDanger} grid place-items-center mb-4`}
              >
                <AdminIcon name="alert" size={24} />
              </div>
              <h2 className={`${styles.emptyTitle} text-base`}>
                {m.channels_load_failed()}
              </h2>
              <p className={`${styles.emptyCopy} mt-1`}>
                {m.channels_load_failed_description()}
              </p>
              <div className="flex mt-5 gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  aria-label={m.reload_channels()}
                  onPress={() => void reload()}
                >
                  {m.retry()}
                </Button>
              </div>
            </div>
          </div>
        ) : channels.length === 0 ? (
          <div className={styles.card}>
            <div className="flex flex-col items-center text-center py-16 px-6">
              <div
                className={`${styles.emptyIcon} grid place-items-center mb-4`}
              >
                <AdminIcon name="channels" size={24} />
              </div>
              <h2 className={`${styles.emptyTitle} text-base`}>
                {m.channels_empty_title()}
              </h2>
              <p className={`${styles.emptyCopy} mt-1`}>
                {m.channels_empty_description()}
              </p>
              <div className="flex mt-5 gap-2">{createButton}</div>
            </div>
          </div>
        ) : (
          <div className={styles.card}>
            <div
              className={`${styles.listHead} flex items-center px-5 py-3 text-sm`}
            >
              <span className={styles.count}>
                {channels.length === 1
                  ? m.channels_count_one()
                  : m.channels_count({ count: String(channels.length) })}
              </span>
            </div>
            <ul className={`${styles.list} m-0 p-0`} aria-label={m.channels()}>
              {channels.map((channel) => (
                <ChannelRow
                  key={channel.id}
                  channel={channel}
                  pending={pendingId === channel.id}
                  renaming={renamingId === channel.id}
                  onStartRename={() => {
                    setActionError(null);
                    setRenamingId(channel.id);
                  }}
                  onCancelRename={() => setRenamingId(null)}
                  onSaveName={(draft) => void saveName(channel, draft)}
                  onViewArticles={() => viewArticles(channel)}
                  onShowPrompt={() => setPromptChannel(channel)}
                  onDelete={() => setDeleteTarget(channel)}
                />
              ))}
            </ul>
          </div>
        )}
      </div>

      <CreateChannelDialog
        isOpen={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(channel) => {
          setCreateOpen(false);
          setChannels((current) => [...current, channel]);
          setLoadState("ready");
          // Refresh quietly so the order matches the server's registry sort.
          void listAdminChannels().then((listed) => {
            if (listed) setChannels(listed);
          });
        }}
      />

      <PromptDialog
        channel={promptChannel}
        onClose={() => setPromptChannel(null)}
      />

      <AlertDialog.Backdrop
        isOpen={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialog.Container>
          <AlertDialog.Dialog>
            <AlertDialog.Header>
              <AlertDialog.Heading>
                {m.channel_delete_heading()}
              </AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body>
              <p>
                {m.channel_delete_body({ name: deleteTarget?.name ?? "" })}
              </p>
            </AlertDialog.Body>
            <AlertDialog.Footer>
              <Button type="button" variant="secondary" slot="close">
                {m.cancel()}
              </Button>
              <Button
                type="button"
                variant="danger"
                slot="close"
                onPress={() => deleteTarget && void removeChannel(deleteTarget)}
              >
                {m.channel_delete()}
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </main>
  );
}

function ChannelRow({
  channel,
  pending,
  renaming,
  onStartRename,
  onCancelRename,
  onSaveName,
  onViewArticles,
  onShowPrompt,
  onDelete,
}: Readonly<{
  channel: Channel;
  pending: boolean;
  renaming: boolean;
  onStartRename: () => void;
  onCancelRename: () => void;
  onSaveName: (draft: string) => void;
  onViewArticles: () => void;
  onShowPrompt: () => void;
  onDelete: () => void;
}>) {
  const [draft, setDraft] = useState(channel.name);
  const inputId = `channel-name-${channel.id}`;

  useEffect(() => {
    if (renaming) setDraft(channel.name);
  }, [renaming, channel.name]);

  return (
    <li
      className={`${styles.row} flex items-center gap-4 py-3.5 px-5 max-[860px]:px-4`}
    >
      <div className={`${styles.channelIcon} grid place-items-center`}>
        <AdminIcon name="channels" size={18} />
      </div>

      {renaming ? (
        <form
          className="flex flex-1 flex-wrap items-center gap-2 min-w-0"
          onSubmit={(event) => {
            event.preventDefault();
            onSaveName(draft);
          }}
        >
          <Input
            autoFocus
            id={inputId}
            className="min-w-[12rem] flex-1"
            aria-label={m.channel_name_for({ name: channel.name })}
            maxLength={CHANNEL_NAME_MAXIMUM_LENGTH}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                onCancelRename();
              }
            }}
          />
          <Button
            type="submit"
            size="sm"
            isPending={pending}
            isDisabled={pending || draft.trim() === ""}
          >
            {m.channel_save_name()}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            isDisabled={pending}
            onPress={onCancelRename}
          >
            {m.cancel()}
          </Button>
        </form>
      ) : (
        <>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span className={`${styles.name} text-base`}>{channel.name}</span>
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <code className={styles.slug}>{channel.slug}</code>
              <span className={styles.meta}>
                {m.channel_created_on({
                  date: formatCreatedAt(channel.createdAt),
                })}
              </span>
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              className={styles.rowAction}
              type="button"
              size="sm"
              variant="ghost"
              aria-label={m.channel_copy_prompt_for({ name: channel.name })}
              onPress={onShowPrompt}
            >
              <AdminIcon name="copy" size={15} />
              {m.channel_copy_prompt()}
            </Button>
            <Button
              className={styles.rowAction}
              type="button"
              size="sm"
              variant="ghost"
              aria-label={m.channel_view_articles_for({ name: channel.name })}
              onPress={onViewArticles}
            >
              {m.channel_view_articles()}
            </Button>
            <Dropdown.Root>
              <Dropdown.Trigger
                className={`${styles.menuTrigger} inline-flex items-center justify-center border-0 cursor-pointer`}
                aria-label={m.more_actions_for({ title: channel.name })}
                isDisabled={pending}
              >
                <AdminIcon name="more" size={18} />
              </Dropdown.Trigger>
              <Dropdown.Popover placement="bottom end">
                <Dropdown.Menu
                  aria-label={m.actions_for({ title: channel.name })}
                  onAction={(key) => {
                    if (key === "view") onViewArticles();
                    else if (key === "copy") onShowPrompt();
                    else if (key === "rename") onStartRename();
                    else if (key === "delete") onDelete();
                  }}
                >
                  <Dropdown.Item id="view" textValue={m.channel_view_articles()}>
                    {m.channel_view_articles()}
                  </Dropdown.Item>
                  <Dropdown.Item id="copy" textValue={m.channel_copy_prompt()}>
                    {m.channel_copy_prompt()}
                  </Dropdown.Item>
                  <Dropdown.Item id="rename" textValue={m.channel_rename()}>
                    {m.channel_rename()}
                  </Dropdown.Item>
                  <Dropdown.Item
                    id="delete"
                    textValue={m.channel_delete()}
                    variant="danger"
                  >
                    {m.channel_delete()}
                  </Dropdown.Item>
                </Dropdown.Menu>
              </Dropdown.Popover>
            </Dropdown.Root>
          </div>
        </>
      )}
    </li>
  );
}

function CreateChannelDialog({
  isOpen,
  onOpenChange,
  onCreated,
}: Readonly<{
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (channel: Channel) => void;
}>) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const slugEdited = useRef(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<CreateError>(null);

  // Reset on close rather than open so a fast first keystroke is never wiped.
  useEffect(() => {
    if (isOpen) return;
    setName("");
    setSlug("");
    slugEdited.current = false;
    setError(null);
  }, [isOpen]);

  async function submit() {
    if (name.trim() === "" || slug.trim() === "") return;
    setCreating(true);
    setError(null);
    const result = await createAdminChannel({
      name: name.trim(),
      slug: slug.trim(),
    });
    setCreating(false);
    if (!result.ok) {
      setError(result.reason);
      return;
    }
    onCreated(result.channel);
  }

  const slugIssue =
    error === "conflict"
      ? m.channel_slug_conflict()
      : error === "invalid"
        ? m.channel_slug_invalid()
        : null;

  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
      <Modal.Container>
        <Modal.Dialog aria-label={m.new_channel()}>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <Modal.Header>
              <div className="flex items-center justify-between gap-3 w-full">
                <Modal.Heading>{m.new_channel()}</Modal.Heading>
                <Modal.CloseTrigger aria-label={m.close_new_channel_dialog()} />
              </div>
            </Modal.Header>
            <Modal.Body>
              <div className="grid gap-5 py-2">
                <SettingsField
                  label={m.channel_name_label()}
                  htmlFor="channelName"
                >
                  <Input
                    autoFocus
                    fullWidth
                    id="channelName"
                    autoComplete="off"
                    maxLength={CHANNEL_NAME_MAXIMUM_LENGTH}
                    placeholder={m.channel_name_placeholder()}
                    value={name}
                    onChange={(event) => {
                      const next = event.target.value;
                      setName(next);
                      if (!slugEdited.current) setSlug(suggestSlug(next));
                    }}
                  />
                </SettingsField>
                <SettingsField
                  label={m.channel_slug_label()}
                  htmlFor="channelSlug"
                  description={slugIssue ? undefined : m.channel_slug_hint()}
                >
                  <Input
                    fullWidth
                    id="channelSlug"
                    className="font-mono"
                    autoComplete="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    maxLength={CHANNEL_SLUG_MAXIMUM_LENGTH}
                    placeholder={m.channel_slug_placeholder()}
                    aria-invalid={slugIssue ? true : undefined}
                    aria-describedby={
                      slugIssue ? "channelSlug-error" : undefined
                    }
                    value={slug}
                    onChange={(event) => {
                      slugEdited.current = event.target.value !== "";
                      setSlug(event.target.value);
                      if (error === "conflict" || error === "invalid") {
                        setError(null);
                      }
                    }}
                  />
                  {slugIssue ? (
                    <p
                      id="channelSlug-error"
                      role="alert"
                      className={`${styles.fieldError} text-xs m-0`}
                    >
                      {slugIssue}
                    </p>
                  ) : null}
                </SettingsField>
                {error === "error" ? (
                  <Alert status="danger" role="alert">
                    <Alert.Content>
                      <Alert.Title>{m.channels_create_failed()}</Alert.Title>
                    </Alert.Content>
                  </Alert>
                ) : null}
              </div>
            </Modal.Body>
            <Modal.Footer>
              <Button type="button" variant="secondary" slot="close">
                {m.cancel()}
              </Button>
              <Button
                type="submit"
                isPending={creating}
                isDisabled={
                  creating || name.trim() === "" || slug.trim() === ""
                }
              >
                {m.create_channel()}
              </Button>
            </Modal.Footer>
          </form>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}

function PromptDialog({
  channel,
  onClose,
}: Readonly<{ channel: Channel | null; onClose: () => void }>) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Keep the last Channel while the dialog animates out.
  const lastChannel = useRef<Channel | null>(null);
  if (channel) lastChannel.current = channel;
  const shown = channel ?? lastChannel.current;

  const prompt = shown
    ? channelIntegrationPrompt({
        origin: globalThis.location?.origin ?? "",
        name: shown.name,
        slug: shown.slug,
        locale: getLocale(),
      })
    : "";

  useEffect(() => {
    setCopyState("idle");
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
  }, [channel]);

  useEffect(
    () => () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    },
    [],
  );

  async function copy() {
    try {
      await navigator.clipboard.writeText(prompt);
    } catch {
      setCopyState("failed");
      return;
    }
    setCopyState("copied");
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopyState("idle"), 2000);
  }

  return (
    <Modal.Backdrop
      isOpen={channel !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Modal.Container size="lg">
        <Modal.Dialog
          aria-label={
            shown ? m.channel_prompt_heading({ name: shown.name }) : undefined
          }
        >
          <Modal.Header>
            <div className="flex items-center justify-between gap-3 w-full">
              <Modal.Heading>
                {shown ? m.channel_prompt_heading({ name: shown.name }) : ""}
              </Modal.Heading>
              <Modal.CloseTrigger aria-label={m.close_prompt_dialog()} />
            </div>
          </Modal.Header>
          <Modal.Body>
            <div className="grid gap-3 py-1">
              <pre
                className={`${styles.prompt} m-0 text-xs`}
                tabIndex={0}
                aria-label={
                  shown
                    ? m.channel_prompt_heading({ name: shown.name })
                    : undefined
                }
              >
                {prompt}
              </pre>
              {copyState === "failed" ? (
                <Alert status="danger" role="alert">
                  <Alert.Content>
                    <Alert.Title>{m.channel_prompt_copy_failed()}</Alert.Title>
                  </Alert.Content>
                </Alert>
              ) : null}
              <p className="visually-hidden" role="status">
                {copyState === "copied" && shown
                  ? m.channel_prompt_copied_for({ name: shown.name })
                  : ""}
              </p>
            </div>
          </Modal.Body>
          <Modal.Footer>
            <Button type="button" variant="secondary" slot="close">
              {m.channel_prompt_close()}
            </Button>
            <Button type="button" onPress={() => void copy()}>
              <AdminIcon
                name={copyState === "copied" ? "check" : "copy"}
                size={16}
              />
              {copyState === "copied"
                ? m.channel_prompt_copied()
                : m.channel_prompt_copy()}
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}

function ChannelListSkeleton() {
  return (
    <div className={styles.card} aria-busy="true">
      <ul className={`${styles.list} m-0 p-0`}>
        {[0, 1, 2].map((index) => (
          <li
            key={index}
            className={`${styles.skeletonRow} flex items-center gap-4 py-3.5 px-5`}
          >
            <span className={`${styles.skeleton} block w-10 h-10`} />
            <span className="flex flex-1 flex-col gap-2">
              <span className={`${styles.skeleton} block h-4 w-40`} />
              <span className={`${styles.skeleton} block h-3 w-56`} />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
