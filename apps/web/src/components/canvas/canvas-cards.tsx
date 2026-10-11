"use client";

import { type Node, type NodeProps, NodeResizer, NodeToolbar, Position } from "@xyflow/react";
import { useEffect, useRef, useState } from "react";

import {
  COLOR_STYLES,
  fontFamily,
  type NoteContent,
  type SectionContent,
  TEXT_COLOR_STYLES,
  TEXT_SIZE_PX,
  type TextContent,
} from "@/lib/canvas-style";
import { loadFont } from "@/lib/fonts";

import { handles } from "./handles";
import { ColorPicker, FontPicker, ShapePicker, SizePicker, TextColorPicker } from "./style-pickers";

// A type alias (not an interface) so it satisfies React Flow's Record<string, unknown> data.
type Editable<C> = {
  content: C;
  editable: boolean;
  /** Saves a full replacement of the card's content. */
  onSave: (content: C) => void;
  /** Focus the text right after the card is placed. */
  autoFocus?: boolean;
};

export type NoteNode = Node<Editable<NoteContent>, "note">;
export type TextNode = Node<Editable<TextContent>, "text">;
export type SectionNode = Node<
  Editable<SectionContent> & {
    onResize: (box: { x: number; y: number; width: number; height: number }) => void;
  },
  "section"
>;

/** Text that saves on blur, starting from the saved value. */
function useDraft(saved: string, save: (text: string) => void) {
  const [text, setText] = useState(saved);
  return {
    text,
    setText,
    commit: () => {
      if (text !== saved) save(text);
    },
  };
}

function Toolbar({ visible, children }: { visible: boolean; children: React.ReactNode }) {
  return (
    <NodeToolbar isVisible={visible} position={Position.Top} offset={10}>
      <div className="nodrag flex max-w-[22rem] flex-wrap items-center gap-3 rounded-lg border border-zinc-200 bg-white p-2 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
        {children}
      </div>
    </NodeToolbar>
  );
}

const NOTE_BOX: Record<NoteContent["shape"], string> = {
  square: "h-48 w-48 rounded-sm p-3",
  rounded: "h-36 w-60 rounded-2xl p-3",
  circle: "h-52 w-52 rounded-full px-9 py-12",
  diamond: "h-60 w-60 px-[4.25rem] py-[4.5rem]",
};

export function NoteCard({ data, selected }: NodeProps<NoteNode>) {
  const { content, editable, onSave } = data;
  const draft = useDraft(content.text, (text) => onSave({ ...content, text }));
  const color = COLOR_STYLES[content.color];
  useEffect(() => loadFont(content.font), [content.font]);
  const diamond = content.shape === "diamond";

  return (
    <>
      <Toolbar visible={selected && editable}>
        <ShapePicker value={content.shape} onChange={(shape) => onSave({ ...content, shape })} />
        <ColorPicker value={content.color} onChange={(c) => onSave({ ...content, color: c })} />
        <div className="w-44">
          <FontPicker value={content.font} onChange={(font) => onSave({ ...content, font })} />
        </div>
      </Toolbar>
      <div
        className={`relative flex shadow-sm ${NOTE_BOX[content.shape]} ${
          diamond ? "" : `border ${color.border}`
        } ${color.fill} ${selected ? "outline outline-2 outline-blue-500" : ""}`}
        style={diamond ? { clipPath: "polygon(50% 0, 100% 50%, 50% 100%, 0 50%)" } : undefined}
      >
        {handles}
        <textarea
          className={`nodrag h-full w-full resize-none bg-transparent outline-none placeholder:text-current placeholder:opacity-40 ${
            content.shape === "circle" || diamond ? "text-center" : ""
          }`}
          style={{ fontFamily: fontFamily(content.font), fontSize: 15 }}
          value={draft.text}
          readOnly={!editable}
          autoFocus={data.autoFocus}
          placeholder="Note"
          onChange={(e) => draft.setText(e.target.value)}
          onBlur={draft.commit}
        />
      </div>
    </>
  );
}

export function TextCard({ data, selected }: NodeProps<TextNode>) {
  const { content, editable, onSave } = data;
  const draft = useDraft(content.text, (text) => onSave({ ...content, text }));
  useEffect(() => loadFont(content.font), [content.font]);
  const size = TEXT_SIZE_PX[content.size];

  return (
    <>
      <Toolbar visible={selected && editable}>
        <SizePicker value={content.size} onChange={(s) => onSave({ ...content, size: s })} />
        <TextColorPicker value={content.color} onChange={(c) => onSave({ ...content, color: c })} />
        <div className="w-44">
          <FontPicker value={content.font} onChange={(font) => onSave({ ...content, font })} />
        </div>
      </Toolbar>
      <div
        className={`rounded px-1 ${selected ? "outline outline-1 outline-blue-500" : "hover:outline hover:outline-1 hover:outline-zinc-300 dark:hover:outline-zinc-600"}`}
      >
        <textarea
          className={`nodrag block min-w-24 resize-none overflow-hidden bg-transparent leading-tight outline-none placeholder:opacity-40 ${TEXT_COLOR_STYLES[content.color].text}`}
          // Grows with its text (CSS field-sizing), so text reads like text, not a box.
          style={
            {
              fontFamily: fontFamily(content.font),
              fontSize: size,
              fieldSizing: "content",
              fontWeight: content.size === "heading" ? 700 : 400,
            } as React.CSSProperties
          }
          value={draft.text}
          readOnly={!editable}
          autoFocus={data.autoFocus}
          placeholder="Type something"
          rows={1}
          onChange={(e) => draft.setText(e.target.value)}
          onBlur={draft.commit}
        />
      </div>
    </>
  );
}

export function SectionCard({ data, selected }: NodeProps<SectionNode>) {
  const { content, editable, onSave, onResize } = data;
  const draft = useDraft(content.title, (title) => onSave({ ...content, title }));
  const input = useRef<HTMLInputElement>(null);

  return (
    <>
      <NodeResizer
        isVisible={selected && editable}
        minWidth={160}
        minHeight={100}
        lineClassName="!border-blue-500"
        handleClassName="!h-2.5 !w-2.5 !border-blue-500 !bg-white"
        onResizeEnd={(_event, box) => onResize(box)}
      />
      <Toolbar visible={selected && editable}>
        <ColorPicker value={content.color} onChange={(c) => onSave({ ...content, color: c })} />
      </Toolbar>
      <div
        className={`h-full w-full rounded-xl border-2 border-dashed ${COLOR_STYLES[content.color].tint}`}
      >
        <input
          ref={input}
          className="nodrag m-2 w-[calc(100%-1rem)] max-w-xs truncate rounded bg-transparent px-1 text-sm font-semibold text-zinc-700 outline-none focus:bg-white/70 dark:text-zinc-200 dark:focus:bg-zinc-900/70"
          value={draft.text}
          readOnly={!editable}
          autoFocus={data.autoFocus}
          placeholder="Section title"
          onChange={(e) => draft.setText(e.target.value)}
          onBlur={draft.commit}
          onKeyDown={(e) => e.key === "Enter" && input.current?.blur()}
        />
      </div>
    </>
  );
}
