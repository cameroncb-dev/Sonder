import { Suspense } from "react";

import { ProjectCanvasRoute } from "./project-canvas-route";

export default function ProjectPage() {
  return (
    <Suspense fallback={<p className="p-6 text-sm text-zinc-500">Loading canvas…</p>}>
      <ProjectCanvasRoute />
    </Suspense>
  );
}
