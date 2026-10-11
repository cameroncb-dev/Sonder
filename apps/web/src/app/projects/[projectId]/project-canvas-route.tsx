"use client";

import { useParams } from "next/navigation";

import { ProjectCanvas } from "@/components/canvas/project-canvas";

export function ProjectCanvasRoute() {
  const { projectId } = useParams<{ projectId: string }>();
  return <ProjectCanvas projectId={projectId} />;
}
