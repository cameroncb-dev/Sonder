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
import { useEffect, useRef, useState } from "react";

import { api, ApiClientError } from "@/lib/api-client";
import { createClient } from "@/lib/supabase/client";

import { Inspector } from "./inspector";
import { nodeTypes } from "./nodes";
import type { CanvasData, CanvasItem } from "./types";

const STATUS_REFRESH_MS = 15_000;

function toNodes(canvas: CanvasData, onSaveNote: (item: CanvasItem, text: string) => void): Node[] {
  const draggable = canvas.role !== "reviewer";
  return canvas.items.flatMap((item): Node[] => {
    const position = { x: item.x, y: item.y };
    if (item.item_type === "asset") {
      const asset = canvas.assets.find((a) => a.id === item.ref_id);
      return asset ? [{ id: item.id, type: "asset", position, draggable, data: { asset } }] : [];
    }
    if (item.item_type === "note") {
      const data = {
        text: String(item.content.text ?? ""),
        editable: draggable,
        onSave: (text: string) => onSaveNote(item, text),
      };
      return [{ id: item.id, type: "note", position, draggable, data }];
    }
    if (item.item_type === "reference") {
      return [
        {
          id: item.id,
          type: "reference",
          position,
          draggable,
          data: { name: String(item.content.name ?? ""), url: item.url ?? null },
        },
      ];
    }
    return [];
  });
}

const toEdges = (canvas: CanvasData): Edge[] =>
  canvas.connections.map((c) => ({
    id: c.id,
    source: c.from_item_id,
    target: c.to_item_id,
    label: c.label ?? undefined,
    style: { strokeDasharray: "4 4" },
  }));

function CanvasInner({ projectId }: { projectId: string }) {
  const [data, setData] = useState<CanvasData | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedAsset, setSelectedAsset] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** Full reload: positions, cards and connections. */
  const [reloadKey, setReloadKey] = useState(0);
  /** Soft refresh: asset status and previews only, never positions. */
  const [refreshKey, setRefreshKey] = useState(0);
  const versions = useRef(new Map<string, number>());
  const fileInput = useRef<HTMLInputElement>(null);
  const flow = useReactFlow();
  const base = `/api/projects/${projectId}`;
  const reload = () => setReloadKey((k) => k + 1);

  const report = (e: unknown) => setNotice(e instanceof Error ? e.message : String(e));

  async function saveNote(item: CanvasItem, text: string) {
    try {
      const { item: saved } = await api<{ item: CanvasItem }>(
        "PATCH",
        `${base}/canvas/items/${item.id}`,
        {
          version: versions.current.get(item.id) ?? item.version,
          content: { ...item.content, text },
        },
      );
      versions.current.set(saved.id, saved.version);
    } catch (e) {
      setNotice(
        e instanceof ApiClientError && e.status === 409
          ? "That note changed elsewhere; reloaded."
          : String(e),
      );
      reload();
    }
  }

  useEffect(() => {
    let cancelled = false;
    api<CanvasData>("GET", `${base}/canvas`)
      .then((canvas) => {
        if (cancelled) return;
        for (const item of canvas.items) versions.current.set(item.id, item.version);
        setData(canvas);
        setNodes(toNodes(canvas, (item, text) => void saveNote(item, text)));
        setEdges(toEdges(canvas));
      })
      .catch((e) => !cancelled && report(e));
    return () => {
      cancelled = true;
    };
    // saveNote only reads refs and stable setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, reloadKey, setNodes, setEdges]);

  useEffect(() => {
    if (refreshKey === 0) return;
    let cancelled = false;
    api<CanvasData>("GET", `${base}/canvas`)
      .then((canvas) => {
        if (cancelled) return;
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

  async function onNodeDragStop(_event: unknown, node: Node) {
    try {
      const { item } = await api<{ item: CanvasItem }>("PATCH", `${base}/canvas/items/${node.id}`, {
        version: versions.current.get(node.id),
        x: Math.round(node.position.x),
        y: Math.round(node.position.y),
      });
      versions.current.set(item.id, item.version);
    } catch (e) {
      if (e instanceof ApiClientError && e.status === 409) {
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
      } else {
        report(e);
      }
    }
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
          style: { strokeDasharray: "4 4" },
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
    // Asset cards cannot be deleted; reload restores any that were removed locally.
    if (deleted.some((n) => n.type === "asset")) reload();
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

  async function addNote() {
    const { x, y } = center();
    try {
      await api("POST", `${base}/canvas/items`, { itemType: "note", x, y, content: { text: "" } });
      reload();
    } catch (e) {
      report(e);
    }
  }

  async function uploadReference(file: File) {
    const { x, y } = center();
    const path = `${projectId}/${crypto.randomUUID()}-${file.name.replace(/[^\w.-]+/g, "_")}`;
    const { error } = await createClient()
      .storage.from("references")
      .upload(path, file, { contentType: file.type });
    if (error) return setNotice(`Upload failed: ${error.message}`);
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
              <button
                className="rounded border border-zinc-300 px-3 py-1 dark:border-zinc-700"
                onClick={() => void addNote()}
              >
                Add note
              </button>
              <button
                className="rounded border border-zinc-300 px-3 py-1 dark:border-zinc-700"
                onClick={() => fileInput.current?.click()}
              >
                Add reference
              </button>
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
        <div className="min-w-0 flex-1">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeDragStop={(e, node) => void onNodeDragStop(e, node)}
            onConnect={canEdit ? onConnect : undefined}
            onEdgesDelete={canEdit ? onEdgesDelete : undefined}
            onNodesDelete={canEdit ? onNodesDelete : undefined}
            onNodeClick={(_e, node) =>
              setSelectedAsset(
                node.type === "asset" ? (node.data as { asset: { id: string } }).asset.id : null,
              )
            }
            onPaneClick={() => setSelectedAsset(null)}
            nodesConnectable={canEdit}
            colorMode="system"
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
          />
        )}
      </div>
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
