import { Handle, Position } from "@xyflow/react";

/** Large enough to find and grab; drag from one card's dot to another's to connect them. */
const HANDLE =
  "!h-3.5 !w-3.5 !border-2 !border-white !bg-blue-500 transition-transform hover:!scale-150 dark:!border-zinc-900";

export const handles = (
  <>
    <Handle type="target" position={Position.Left} className={HANDLE} title="Connect" />
    <Handle type="source" position={Position.Right} className={HANDLE} title="Drag to connect" />
  </>
);
