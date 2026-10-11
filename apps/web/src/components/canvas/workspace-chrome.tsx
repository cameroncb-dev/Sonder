"use client";

import { useStore } from "@xyflow/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { SonderLogo } from "@/components/brand/logo";
import { api } from "@/lib/api-client";
import { createClient } from "@/lib/supabase/client";

import type { ToolPanel } from "./toolbox";

/** Simple line icons (24×24, stroked). */
const ICONS = {
  menu: "M4 7h16M4 12h16M4 17h16",
  select: "M5 3l13 7-6 1.5L9.5 18z",
  note: "M5 4h14v11l-5 5H5zM14 20v-5h5",
  text: "M5 6V4h14v2M12 4v16M9 20h6",
  section:
    "M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M9 10h6",
  theme:
    "M12 3a9 9 0 1 0 0 18c1.1 0 1.6-.9 1.2-1.8-.5-1-.1-2.2 1.1-2.2H17a4 4 0 0 0 4-4c0-5.5-4-10-9-10zM7.5 11.5h.01M10 7.5h.01M15 7.5h.01",
  direction: "M5 21V4M5 4h11l-2 4 2 4H5",
  reference: "M4 5h16v14H4zM4 15l4-4 4 4 3-3 5 5M15 9h.01",
  tools: "M5 5h4v4H5zM15 5h4v4h-4zM5 15h4v4H5zM15 15h4v4h-4z",
  zoomIn: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4M11 8v6M8 11h6",
  zoomOut: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4M8 11h6",
  fit: "M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5",
  map: "M9 4L3 6v14l6-2 6 2 6-2V4l-6 2zM9 4v14M15 6v14",
  sparkle:
    "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z",
  help: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17h.01",
  share: "M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M16 6l-4-4-4 4M12 2v13",
  undo: "M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3",
} as const;
export type IconName = keyof typeof ICONS;

export function Icon({
  name,
  className = "h-[18px] w-[18px]",
}: {
  name: IconName;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={ICONS[name]} />
    </svg>
  );
}

const railButton = (active: boolean) =>
  `group relative grid h-10 w-10 place-items-center rounded-xl transition focus-visible:outline-2 focus-visible:outline-cyan ${
    active
      ? "bg-gradient-to-br from-electric/90 to-violet/90 text-white shadow-[0_6px_20px_-6px_rgba(139,92,246,0.8)]"
      : "text-zinc-300 hover:bg-white/[0.07] hover:text-white"
  }`;

/** Label shown beside a rail button on hover or focus. */
function Tip({ label, side }: { label: string; side: "left" | "right" }) {
  return (
    <span
      className={`pointer-events-none absolute top-1/2 z-50 -translate-y-1/2 whitespace-nowrap rounded-md bg-zinc-800 px-2 py-1 text-xs text-white opacity-0 shadow-lg transition group-hover:opacity-100 group-focus-visible:opacity-100 ${
        side === "right" ? "left-full ml-2.5" : "right-full mr-2.5"
      }`}
    >
      {label}
    </span>
  );
}

export function RailButton({
  icon,
  label,
  active = false,
  side = "right",
  onClick,
  disabled,
}: {
  icon: IconName;
  label: string;
  active?: boolean;
  side?: "left" | "right";
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      className={`${railButton(active)} disabled:opacity-40`}
      onClick={onClick}
      disabled={disabled}
    >
      <Icon name={icon} />
      <Tip label={label} side={side} />
    </button>
  );
}

const TOOLS: Array<{ id: ToolPanel; icon: IconName; label: string }> = [
  { id: "notes", icon: "note", label: "Notes" },
  { id: "text", icon: "text", label: "Text" },
  { id: "sections", icon: "section", label: "Sections" },
  { id: "themes", icon: "theme", label: "Themes" },
  { id: "directions", icon: "direction", label: "Directions" },
];

/** Floating tool rail on the left of the canvas. */
export function ToolRail({
  panel,
  onPanel,
  onSelectTool,
  onAddReference,
  placingKind,
}: {
  panel: ToolPanel | "all" | null;
  onPanel: (panel: ToolPanel | "all" | null) => void;
  onSelectTool: () => void;
  onAddReference: () => void;
  placingKind: string | null;
}) {
  const kindPanel: Record<string, ToolPanel> = {
    note: "notes",
    text: "text",
    section: "sections",
    theme: "themes",
    direction: "directions",
  };
  const placingPanel = placingKind ? kindPanel[placingKind] : undefined;
  return (
    <nav
      aria-label="Canvas tools"
      className="flex w-14 shrink-0 flex-col items-center gap-1 rounded-2xl border border-white/[0.07] bg-zinc-900/90 p-2 shadow-[0_20px_50px_-20px_rgba(0,0,0,0.8)] backdrop-blur-xl"
    >
      <RailButton
        icon="select"
        label="Select (Esc)"
        active={!panel && !placingKind}
        onClick={onSelectTool}
      />
      <span className="my-1 h-px w-6 bg-white/10" />
      {TOOLS.map((t) => (
        <RailButton
          key={t.id}
          icon={t.icon}
          label={t.label}
          active={panel === t.id || placingPanel === t.id}
          onClick={() => onPanel(panel === t.id ? null : t.id)}
        />
      ))}
      <RailButton icon="reference" label="Add reference image" onClick={onAddReference} />
      <span className="my-1 h-px w-6 bg-white/10" />
      <RailButton
        icon="tools"
        label={panel === "all" ? "Hide all tools" : "All tools"}
        active={panel === "all"}
        onClick={() => onPanel(panel === "all" ? null : "all")}
      />
    </nav>
  );
}

/** Current zoom, read from React Flow without re-rendering the whole canvas. */
function ZoomLevel({ onFit }: { onFit: () => void }) {
  const zoom = useStore((s) => s.transform[2]);
  return (
    <button
      type="button"
      onClick={onFit}
      title="Fit all cards"
      className="min-w-14 rounded-lg px-2 py-1 text-xs tabular-nums text-zinc-300 transition hover:bg-white/[0.07] hover:text-white focus-visible:outline-2 focus-visible:outline-cyan"
    >
      {Math.round(zoom * 100)}%
    </button>
  );
}

/** Compact utility rail on the right of the canvas: zoom, overview map, AI, help. */
export function UtilityRail({
  onZoomIn,
  onZoomOut,
  onFit,
  minimap,
  onToggleMinimap,
  onOrganize,
}: {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  minimap: boolean;
  onToggleMinimap: () => void;
  onOrganize?: () => void;
}) {
  const router = useRouter();
  return (
    <div className="flex w-12 flex-col items-center gap-1 rounded-2xl border border-white/[0.07] bg-zinc-900/90 p-1 shadow-[0_20px_50px_-20px_rgba(0,0,0,0.8)] backdrop-blur-xl">
      <RailButton icon="zoomIn" label="Zoom in" side="left" onClick={onZoomIn} />
      <RailButton icon="zoomOut" label="Zoom out" side="left" onClick={onZoomOut} />
      <RailButton icon="fit" label="Fit all cards" side="left" onClick={onFit} />
      <RailButton
        icon="map"
        label={minimap ? "Hide overview" : "Show overview"}
        side="left"
        active={minimap}
        onClick={onToggleMinimap}
      />
      {onOrganize && (
        <>
          <span className="my-0.5 h-px w-5 bg-white/10" />
          <RailButton icon="sparkle" label="Organize with AI" side="left" onClick={onOrganize} />
        </>
      )}
      <span className="my-0.5 h-px w-5 bg-white/10" />
      <RailButton
        icon="help"
        label="Connect help"
        side="left"
        onClick={() => router.push("/connect")}
      />
    </div>
  );
}

function useClickAway(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, close]);
  return ref;
}

const menuPanel =
  "absolute z-50 mt-2 min-w-52 overflow-hidden rounded-xl border border-white/10 bg-zinc-900/95 p-1.5 shadow-2xl backdrop-blur-xl";
const menuItem =
  "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-zinc-200 hover:bg-white/[0.07] focus-visible:bg-white/[0.07] focus-visible:outline-none";

function MainMenu() {
  const [open, setOpen] = useState(false);
  const ref = useClickAway(open, () => setOpen(false));
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label="Menu"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((o) => !o)}
        className={railButton(open).replace("h-10 w-10", "h-9 w-9")}
      >
        <Icon name="menu" />
      </button>
      {open && (
        <div role="menu" className={`${menuPanel} left-0`}>
          <Link role="menuitem" className={menuItem} href="/projects">
            All projects
          </Link>
          <Link role="menuitem" className={menuItem} href="/connect">
            Connect Photoshop
          </Link>
          <Link role="menuitem" className={menuItem} href="/">
            Sonder home
          </Link>
        </div>
      )}
    </div>
  );
}

function UserMenu() {
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const ref = useClickAway(open, () => setOpen(false));
  useEffect(() => {
    void createClient()
      .auth.getUser()
      .then(({ data }) => setEmail(data.user?.email ?? null));
  }, []);
  const initial = (email ?? "?").charAt(0).toUpperCase();
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={email ? `Account: ${email}` : "Account"}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((o) => !o)}
        className="bg-sonder grid h-8 w-8 place-items-center rounded-full p-[2px] transition hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan"
      >
        <span className="grid h-full w-full place-items-center rounded-full bg-zinc-900 text-xs font-semibold text-white">
          {initial}
        </span>
      </button>
      {open && (
        <div role="menu" className={`${menuPanel} right-0`}>
          {email && <p className="truncate px-3 py-2 text-xs text-zinc-400">{email}</p>}
          <button
            role="menuitem"
            type="button"
            className={menuItem}
            onClick={async () => {
              await createClient().auth.signOut();
              router.replace("/login");
              router.refresh();
            }}
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

/** Share: copy the project link, and (for owners) add teammates by email. */
export function ShareDialog({
  projectId,
  projectName,
  isOwner,
  onClose,
}: {
  projectId: string;
  projectName: string;
  isOwner: boolean;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"editor" | "reviewer" | "owner">("editor");
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const url =
    typeof window === "undefined" ? "" : `${window.location.origin}/projects/${projectId}`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-labelledby="share-title"
        className="flex w-full max-w-md flex-col gap-5 rounded-2xl border border-white/10 bg-zinc-900 p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && onClose()}
      >
        <div>
          <h2 id="share-title" className="text-lg font-semibold text-white">
            Share {projectName}
          </h2>
          <p className="mt-1 text-sm text-zinc-400">
            Only project members can open the link.{" "}
            {isOwner ? "Add teammates below." : "Ask an owner to add people."}
          </p>
        </div>
        <div className="flex gap-2">
          <input
            readOnly
            value={url}
            className="field min-w-0 flex-1 !py-2 !text-xs"
            aria-label="Project link"
          />
          <button
            type="button"
            className="btn-ghost shrink-0 !py-2"
            onClick={() =>
              void navigator.clipboard.writeText(url).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1800);
              })
            }
          >
            {copied ? "Copied ✓" : "Copy link"}
          </button>
        </div>
        {isOwner && (
          <form
            className="flex flex-col gap-3"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setStatus(null);
              try {
                await api("POST", `/api/projects/${projectId}/members`, { email, role });
                setStatus({ ok: true, text: `${email} can now open this project as ${role}.` });
                setEmail("");
              } catch (err) {
                setStatus({ ok: false, text: err instanceof Error ? err.message : String(err) });
              } finally {
                setBusy(false);
              }
            }}
          >
            <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              Add a teammate
            </span>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                type="email"
                required
                placeholder="teammate@studio.com"
                className="field min-w-0 flex-1 !py-2"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-label="Teammate email"
              />
              <select
                className="field !w-auto !py-2"
                value={role}
                onChange={(e) => setRole(e.target.value as typeof role)}
                aria-label="Role"
              >
                <option value="editor">Editor</option>
                <option value="reviewer">Reviewer</option>
                <option value="owner">Owner</option>
              </select>
            </div>
            <button className="btn-sonder self-start" disabled={busy}>
              {busy ? "Adding…" : "Add to project"}
            </button>
            {status && (
              <p role="status" className={`text-sm ${status.ok ? "text-cyan" : "text-pink-300"}`}>
                {status.text}
              </p>
            )}
          </form>
        )}
        <div className="flex justify-end">
          <button type="button" className="btn-ghost !py-2" onClick={onClose} autoFocus>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

/** Top application bar of the workspace. */
export function AppBar({
  title,
  role,
  notice,
  onFit,
  onShare,
  actions,
}: {
  title: string;
  role?: string;
  notice: string | null;
  onFit: () => void;
  onShare: () => void;
  actions?: React.ReactNode;
}) {
  return (
    <header className="relative z-30 flex h-14 shrink-0 items-center gap-3 border-b border-white/[0.06] bg-ink/95 px-3 backdrop-blur-xl">
      <MainMenu />
      <SonderLogo size={28} wordmark={false} href="/projects" />
      <span className="h-5 w-px bg-white/10" />
      <div className="flex min-w-0 items-center gap-2">
        <h1 className="truncate text-sm font-semibold text-white">{title}</h1>
        {role && (
          <span className="hidden rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] capitalize text-zinc-300 sm:inline">
            {role}
          </span>
        )}
      </div>
      <div className="mx-auto hidden items-center gap-1 rounded-xl border border-white/[0.06] bg-white/[0.03] px-1 md:flex">
        <ZoomLevel onFit={onFit} />
      </div>
      <div className="ml-auto flex items-center gap-2">
        {notice && (
          <span
            role="status"
            className="max-w-[30vw] truncate rounded-full border border-gold/20 bg-gold/10 px-3 py-1 text-xs text-amber-200 lg:max-w-xs"
            title={notice}
          >
            {notice}
          </span>
        )}
        {actions}
        <button type="button" className="btn-sonder !px-4 !py-1.5" onClick={onShare}>
          <Icon name="share" className="h-4 w-4" />
          Share
        </button>
        <UserMenu />
      </div>
    </header>
  );
}
