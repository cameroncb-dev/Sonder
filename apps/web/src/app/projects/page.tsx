import { SiteNav } from "@/components/brand/site-nav";

import { ProjectsDashboard } from "./projects-dashboard";

export default function ProjectsPage() {
  return (
    <div className="glow-field flex flex-1 flex-col">
      <SiteNav />
      <ProjectsDashboard />
    </div>
  );
}
