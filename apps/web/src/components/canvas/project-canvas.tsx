"use client";

import "@xyflow/react/dist/style.css";

import {
  Background,
  Controls,
  type Edge,
  MiniMap,
  type Node,
  type OnConnect,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from "@xyflow/react";
import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { api, ApiClientError } from "@/lib/api-client";
import { NoteContent, SECTION_SIZE, SectionContent, TextContent } from "@/lib/canvas-style";
import { createClient } from "@/lib/supabase/client";

import { Inspector } from "./inspector";
import { type PlacingTool, Toolbox, WaffleButton } from "./toolbox";
import { nodeTypes } from "./nodes";
import type { CanvasAsset, CanvasData, CanvasItem } from "./types";

const STATUS_REFRESH_MS = 15_000;
/** Matches the `references` storage bucket's file size limit. */
const MAX_REFERENCE_BYTES = 20 * 1024 * 1024;
const REFERENCE_TYPES = ["image/png", "image/jpeg", "image/webp"];
const megabytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
/** Dashed to read as an organising link, not version history. */
const EDGE_STYLE = { strokeDasharray: "6 4", strokeWidth: 2 };

const DARK_QUERY = "(prefers-color-scheme: dark)";

/** System theme. The server snapshot is "light"; React re-renders after hydration without a mismatch. */
function useColorMode(): "light" | "dark" {
  return useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia(DARK_QUERY);
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    },
    () => (window.matchMedia(DARK_QUERY).matches ? "dark" : "light"),
    () => "light",
  );
}

interface CardHandlers {
  save: (itemId: string, content: Record<string, unknown>) => void;
  resize: (itemId: string, box: { x: number; y: number; width: number; height: number }) => void;
}

/** Parses saved content, falling back to defaults for cards saved before styles existed. */
function parsed<T>(
  schema: { safeParse: (v: unknown) => { success: boolean; data?: T } },
  value: unknown,
  fallback: T,
): T {
  const result = schema.safeParse(value);
  return result.success ? result.data! : fallback;
}

function toNodes(canvas: CanvasData, handlers: CardHandlers, focusId: string | null): Node[] {
  const draggable = canvas.role !== "reviewer";
  // Sections first and beneath everything, so cards on top of them stay clickable.
  const items = [...canvas.items].sort(
    (a, b) => Number(b.item_type === "section") - Number(a.item_type === "section"),
  );
  return items.flatMap((item): Node[] => {
    const position = { x: item.x, y: item.y };
    const common = { id: item.id, position, draggable };
    const editable = {
      editable: draggable,
      autoFocus: item.id === focusId,
      onSave: (content: Record<string, unknown>) => handlers.save(item.id, content),
    };
    const text = String(item.content.text ?? "");
    switch (item.item_type) {
      case "asset": {
        const asset = canvas.assets.find((a) => a.id === item.ref_id);
        return asset ? [{ ...common, type: "asset", data: { asset } }] : [];
      }
      case "note":
        return [
          {
            ...common,
            type: "note",
            data: {
              ...editable,
              content: parsed(NoteContent, item.content, NoteContent.parse({ text })),
            },
          },
        ];
      case "text":
        return [
          {
            ...common,
            type: "text",
            data: {
              ...editable,
              content: parsed(TextContent, item.content, TextContent.parse({ text })),
            },
          },
        ];
      case "section":
        return [
          {
            ...common,
            type: "section",
            zIndex: -1,
            width: item.width ?? SECTION_SIZE.width,
            height: item.height ?? SECTION_SIZE.height,
            data: {
              ...editable,
              content: parsed(SectionContent, item.content, SectionContent.parse({ title: "" })),
              onResize: (box: { x: number; y: number; width: number; height: number }) =>
                handlers.resize(item.id, box),
            },
          },
        ];
      case "reference":
        return [
          {
            ...common,
            type: "reference",
            data: { name: String(item.content.name ?? ""), url: item.url ?? null },
          },
        ];
      default:
        return [];
    }
  });
}

const toEdges = (canvas: CanvasData): Edge[] =>
  canvas.connections.map((c) => ({
    id: c.id,
    source: c.from_item_id,
    target: c.to_item_id,
    label: c.label ?? undefined,
    style: EDGE_STYLE,
  }));

function CanvasInner({ projectId }: { projectId: string }) {
  const [data, setData] = useState<CanvasData | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedAsset, setSelectedAsset] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** Document awaiting delete confirmation in the canvas popup. */
  const [pendingDelete, setPendingDelete] = useState<CanvasAsset | null>(null);
  const [deleting, setDeleting] = useState(false);
  /** Upload problem shown in a popup. */
  const [uploadError, setUploadError] = useState<{ title: string; detail: string } | null>(null);
  /** Card style chosen in the toolbox, waiting for a click on the canvas. */
  const [placing, setPlacing] = useState<PlacingTool | null>(null);
  const [toolsOpen, setToolsOpen] = useState(true);
  /** A card just placed, whose text should take focus once it renders. */
  const focusId = useRef<string | null>(null);
  /** Cards inside a section being dragged, with their positions when the drag began. */
  const carried = useRef<{
    start: { x: number; y: number };
    cards: Map<string, { x: number; y: number }>;
  } | null>(null);
  /** Full reload: positions, cards and connections. */
  const [reloadKey, setReloadKey] = useState(0);
  /** Soft refresh: asset status and previews only, never positions. */
  const [refreshKey, setRefreshKey] = useState(0);
  const versions = useRef(new Map<string, number>());
  /** Frame all cards after the next full load: on open, and when a new document card appears. */
  const fitPending = useRef(true);
  const fileInput = useRef<HTMLInputElement>(null);
  const flow = useReactFlow();
  const colorMode = useColorMode();
  const base = `/api/projects/${projectId}`;
  const reload = () => setReloadKey((k) => k + 1);

  const report = (e: unknown) => setNotice(e instanceof Error ? e.message : String(e));

  /** Saves one card's fields with its version; on a conflict, reloads the latest layout. */
  async function patchItem(itemId: string, fields: Record<string, unknown>) {
    try {
      const { item: saved } = await api<{ item: CanvasItem }>(
        "PATCH",
        `${base}/canvas/items/${itemId}`,
        { version: versions.current.get(itemId), ...fields },
      );
      versions.current.set(saved.id, saved.version);
    } catch (e) {
      setNotice(
        e instanceof ApiClientError && e.status === 409
          ? "That card changed elsewhere; reloaded the latest version."
          : e instanceof Error
            ? e.message
            : String(e),
      );
      reload();
    }
  }

  const handlers: CardHandlers = {
    save: (itemId, content) => {
      // Show style changes immediately; the save confirms them.
      setNodes((ns) =>
        ns.map((n) => (n.id === itemId ? { ...n, data: { ...n.data, content } } : n)),
      );
      void patchItem(itemId, { content });
    },
    resize: (itemId, box) =>
      void patchItem(itemId, {
        x: Math.round(box.x),
        y: Math.round(box.y),
        width: Math.round(box.width),
        height: Math.round(box.height),
      }),
  };

  useEffect(() => {
    let cancelled = false;
    api<CanvasData>("GET", `${base}/canvas`)
      .then((canvas) => {
        if (cancelled) return;
        for (const item of canvas.items) versions.current.set(item.id, item.version);
        setData(canvas);
        setNodes(toNodes(canvas, handlers, focusId.current));
        focusId.current = null;
        setEdges(toEdges(canvas));
        if (fitPending.current) {
          fitPending.current = false;
          // Wait for the new nodes to render before framing them.
          requestAnimationFrame(() => void flow.fitView({ padding: 0.2, duration: 200 }));
        }
      })
      .catch((e) => !cancelled && report(e));
    return () => {
      cancelled = true;
    };
    // The handlers only read refs and stable setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, reloadKey, setNodes, setEdges]);

  useEffect(() => {
    if (refreshKey === 0) return;
    let cancelled = false;
    api<CanvasData>("GET", `${base}/canvas`)
      .then((canvas) => {
        if (cancelled) return;
        // A document linked since the last full load gets a new card; load it with its position.
        if (canvas.items.some((i) => !versions.current.has(i.id))) {
          fitPending.current = canvas.items.some(
            (i) => i.item_type === "asset" && !versions.current.has(i.id),
          );
          return setReloadKey((k) => k + 1);
        }
        setData(canvas);
        setNodes((current) =>
          current.map((node) => {
            if (node.type !== "asset") return node;
            const item = canvas.items.find((i) => i.id === node.id);
            const asset = canvas.assets.find((a) => a.id === item?.ref_id);
            return asset ? { ...node, data: { ...node.data, asset } } : node;
          }),
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [base, refreshKey, setNodes]);

  useEffect(() => {
    const timer = setInterval(() => setRefreshKey((k) => k + 1), STATUS_REFRESH_MS);
    return () => clearInterval(timer);
  }, []);

  /** A section carries the cards whose centre lies inside it. */
  function onNodeDragStart(_event: unknown, node: Node) {
    carried.current = null;
    if (node.type !== "section") return;
    const width = node.measured?.width ?? node.width ?? 0;
    const height = node.measured?.height ?? node.height ?? 0;
    const cards = new Map<string, { x: number; y: number }>();
    for (const other of flow.getNodes()) {
      if (other.id === node.id || other.type === "section" || other.selected) continue;
      const cx = other.position.x + (other.measured?.width ?? 0) / 2;
      const cy = other.position.y + (other.measured?.height ?? 0) / 2;
      if (
        cx >= node.position.x &&
        cx <= node.position.x + width &&
        cy >= node.position.y &&
        cy <= node.position.y + height
      )
        cards.set(other.id, { ...other.position });
    }
    carried.current = { start: { ...node.position }, cards };
  }

  function onNodeDrag(_event: unknown, node: Node) {
    const carry = carried.current;
    if (!carry || node.type !== "section") return;
    const dx = node.position.x - carry.start.x;
    const dy = node.position.y - carry.start.y;
    setNodes((ns) =>
      ns.map((n) => {
        const from = carry.cards.get(n.id);
        return from ? { ...n, position: { x: from.x + dx, y: from.y + dy } } : n;
      }),
    );
  }

  async function onNodeDragStop(_event: unknown, node: Node, dragged: Node[]) {
    const moved = new Map(dragged.map((n) => [n.id, n.position]));
    moved.set(node.id, node.position);
    const carry = carried.current;
    carried.current = null;
    if (carry) {
      const dx = node.position.x - carry.start.x;
      const dy = node.position.y - carry.start.y;
      for (const [id, from] of carry.cards) moved.set(id, { x: from.x + dx, y: from.y + dy });
    }
    await Promise.all(
      [...moved].map(([id, position]) =>
        api<{ item: CanvasItem }>("PATCH", `${base}/canvas/items/${id}`, {
          version: versions.current.get(id),
          x: Math.round(position.x),
          y: Math.round(position.y),
        })
          .then(({ item }) => versions.current.set(item.id, item.version))
          .catch((e) => {
            if (!(e instanceof ApiClientError && e.status === 409)) throw e;
            const current = (e.details as { current?: CanvasItem } | undefined)?.current;
            if (current) {
              versions.current.set(current.id, current.version);
              setNodes((ns) =>
                ns.map((n) =>
                  n.id === current.id ? { ...n, position: { x: current.x, y: current.y } } : n,
                ),
              );
            }
            setNotice("Someone else moved that card. It has been restored to their position.");
          }),
      ),
    ).catch(report);
  }

  const onConnect: OnConnect = async (connection) => {
    try {
      const { connection: saved } = await api<{ connection: { id: string } }>(
        "POST",
        `${base}/canvas/connections`,
        {
          fromItemId: connection.source,
          toItemId: connection.target,
        },
      );
      setEdges((es) => [
        ...es,
        {
          id: saved.id,
          source: connection.source,
          target: connection.target,
          style: EDGE_STYLE,
        },
      ]);
    } catch (e) {
      report(e);
    }
  };

  function onEdgesDelete(deleted: Edge[]) {
    for (const edge of deleted)
      void api("DELETE", `${base}/canvas/connections/${edge.id}`).catch(reload);
  }

  function onNodesDelete(deleted: Node[]) {
    for (const node of deleted) {
      if (node.type !== "asset")
        void api("DELETE", `${base}/canvas/items/${node.id}`).catch(reload);
    }
  }

  /** Document cards are deleted only after confirming in the popup; other cards go at once. */
  const onBeforeDelete = async ({
    nodes: doomed,
    edges: links,
  }: {
    nodes: Node[];
    edges: Edge[];
  }) => {
    const card = doomed.find((n) => n.type === "asset");
    if (!card) return true;
    setPendingDelete((card.data as { asset: CanvasAsset }).asset);
    return { nodes: doomed.filter((n) => n.type !== "asset"), edges: links };
  };

  async function deleteAsset(asset: CanvasAsset) {
    setDeleting(true);
    try {
      // The popup is the confirmation, including for documents with history.
      await api("DELETE", `${base}/assets/${asset.id}?withHistory=true`);
      setPendingDelete(null);
      setSelectedAsset(null);
      reload();
    } catch (e) {
      report(e);
      setPendingDelete(null);
    } finally {
      setDeleting(false);
    }
  }

  /** Viewport centre, nudged so repeated adds don't stack exactly on top of each other. */
  const center = () => {
    const { x, y } = flow.screenToFlowPosition({
      x: window.innerWidth / 2 - 200,
      y: window.innerHeight / 2,
    });
    const taken = (px: number, py: number) =>
      flow
        .getNodes()
        .some((n) => Math.abs(n.position.x - px) < 8 && Math.abs(n.position.y - py) < 8);
    let step = 0;
    while (taken(x + step * 32, y + step * 32)) step += 1;
    return { x: x + step * 32, y: y + step * 32 };
  };

  /** Places the toolbox's chosen card where the canvas was clicked. */
  async function place(tool: PlacingTool, at: { x: number; y: number }) {
    setPlacing(null);
    const body =
      tool.kind === "section"
        ? {
            itemType: "section",
            x: at.x,
            y: at.y,
            ...SECTION_SIZE,
            content: { title: "", color: tool.color },
          }
        : { itemType: tool.kind, x: at.x, y: at.y, content: tool.content };
    try {
      const { item } = await api<{ item: CanvasItem }>("POST", `${base}/canvas/items`, body);
      focusId.current = item.id;
      reload();
    } catch (e) {
      report(e);
    }
  }

  useEffect(() => {
    if (!placing) return;
    const cancel = (e: KeyboardEvent) => e.key === "Escape" && setPlacing(null);
    window.addEventListener("keydown", cancel);
    return () => window.removeEventListener("keydown", cancel);
  }, [placing]);

  // The toolbox's visibility is remembered in this browser.
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time restore from storage
      setToolsOpen(window.localStorage.getItem("sonder.toolsOpen") !== "false");
    } catch {
      // Storage unavailable: keep the default.
    }
  }, []);
  const toggleTools = () =>
    setToolsOpen((open) => {
      try {
        window.localStorage.setItem("sonder.toolsOpen", String(!open));
      } catch {
        // Ignore: the choice lasts for this visit.
      }
      return !open;
    });

  async function uploadReference(file: File) {
    // Checked before uploading, so a too-large image is reported at once.
    if (file.size > MAX_REFERENCE_BYTES)
      return setUploadError({
        title: "Image too large",
        detail: `"${file.name}" is ${megabytes(file.size)}. Reference images can be at most ${megabytes(MAX_REFERENCE_BYTES)}. Try a smaller or compressed version.`,
      });
    if (!REFERENCE_TYPES.includes(file.type))
      return setUploadError({
        title: "Unsupported image type",
        detail: `"${file.name}" isn't a PNG, JPEG or WebP image.`,
      });
    const { x, y } = center();
    const path = `${projectId}/${crypto.randomUUID()}-${file.name.replace(/[^\w.-]+/g, "_")}`;
    const { error } = await createClient()
      .storage.from("references")
      .upload(path, file, { contentType: file.type });
    if (error)
      return setUploadError({
        title: "Upload failed",
        detail: `"${file.name}" couldn't be uploaded: ${error.message}`,
      });
    try {
      await api("POST", `${base}/canvas/items`, {
        itemType: "reference",
        x,
        y,
        content: { path, name: file.name },
      });
      reload();
    } catch (e) {
      report(e);
    }
  }

  const asset = data?.assets.find((a) => a.id === selectedAsset) ?? null;
  const canEdit = data?.role !== "reviewer";

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200 px-4 py-2 dark:border-zinc-800">
        <div className="flex items-center gap-3">
          {canEdit && <WaffleButton open={toolsOpen} onToggle={toggleTools} />}
          <Link href="/projects" className="text-sm text-zinc-500 hover:underline">
            Projects
          </Link>
          <h1 className="font-semibold">{data?.project.name ?? "…"}</h1>
          {data && (
            <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
              {data.role}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-sm">
          {notice && (
            <span className="max-w-md truncate text-xs text-amber-700 dark:text-amber-400">
              {notice}
            </span>
          )}
          {canEdit && (
            <>
              <input
                ref={fileInput}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void uploadReference(file);
                  e.target.value = "";
                }}
              />
            </>
          )}
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        {canEdit && toolsOpen && (
          <Toolbox
            placing={placing}
            onPlace={setPlacing}
            onCancel={() => setPlacing(null)}
            onAddReference={() => fileInput.current?.click()}
          />
        )}
        <div
          className={`min-w-0 flex-1 ${placing ? "[&_.react-flow__pane]:!cursor-crosshair" : ""}`}
        >
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeDragStart={onNodeDragStart}
            onNodeDrag={onNodeDrag}
            onNodeDragStop={(e, node, dragged) => void onNodeDragStop(e, node, dragged)}
            elevateNodesOnSelect={false}
            onConnect={canEdit ? onConnect : undefined}
            onEdgesDelete={canEdit ? onEdgesDelete : undefined}
            onNodesDelete={canEdit ? onNodesDelete : undefined}
            onBeforeDelete={canEdit ? onBeforeDelete : async () => false}
            onNodeClick={(_e, node) =>
              setSelectedAsset(
                node.type === "asset" ? (node.data as { asset: { id: string } }).asset.id : null,
              )
            }
            onPaneClick={(event) => {
              if (placing)
                return void place(
                  placing,
                  flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }),
                );
              setSelectedAsset(null);
            }}
            nodesConnectable={canEdit}
            colorMode={colorMode}
            fitView
          >
            <Background />
            <Controls />
            <MiniMap pannable zoomable />
          </ReactFlow>
        </div>
        {asset && (
          <Inspector
            key={asset.id}
            projectId={projectId}
            asset={asset}
            onClose={() => setSelectedAsset(null)}
            onChanged={() => setRefreshKey((k) => k + 1)}
            onRequestDelete={() => setPendingDelete(asset)}
          />
        )}
      </div>
      {uploadError && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setUploadError(null)}
        >
          <div
            role="alertdialog"
            aria-labelledby="upload-error-title"
            className="flex w-full max-w-sm flex-col gap-4 rounded-lg bg-white p-5 shadow-xl dark:bg-zinc-900"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="upload-error-title" className="font-semibold">
              {uploadError.title}
            </h2>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">{uploadError.detail}</p>
            <div className="flex justify-end">
              <button
                autoFocus
                className="rounded bg-zinc-900 px-4 py-1.5 text-sm text-white hover:bg-zinc-700 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
                onClick={() => setUploadError(null)}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}
      {pendingDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => !deleting && setPendingDelete(null)}
        >
          <div
            role="alertdialog"
            aria-labelledby="delete-title"
            className="flex w-full max-w-sm flex-col gap-4 rounded-lg bg-white p-5 shadow-xl dark:bg-zinc-900"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="delete-title" className="font-semibold">
              Delete {pendingDelete.name}?
            </h2>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              {pendingDelete.activeBranch
                ? "This project card has some change history. Are you sure you want to delete it?"
                : "Are you sure you want to delete this project card?"}
            </p>
            {pendingDelete.activeBranch && (
              <p className="text-xs text-zinc-500">
                All of its checkpoints, branches and combinations are deleted for everyone. The file
                on your computer isn&apos;t touched.
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button
                autoFocus
                className="rounded bg-zinc-200 px-4 py-1.5 text-sm text-zinc-800 hover:bg-zinc-300 disabled:opacity-50 dark:bg-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-600"
                disabled={deleting}
                onClick={() => setPendingDelete(null)}
              >
                Cancel
              </button>
              <button
                className="rounded bg-red-600 px-4 py-1.5 text-sm text-white hover:bg-red-700 disabled:opacity-50"
                disabled={deleting}
                onClick={() => void deleteAsset(pendingDelete)}
              >
                {deleting ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function ProjectCanvas({ projectId }: { projectId: string }) {
  return (
    <ReactFlowProvider>
      <CanvasInner projectId={projectId} />
    </ReactFlowProvider>
  );
}
