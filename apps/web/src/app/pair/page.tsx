import { SiteNav } from "@/components/brand/site-nav";

import { ConnectExperience } from "../connect/connect-experience";

/** The plugin sends people here with a code: the Connect guide, opened at the code step. */
export default function PairPage() {
  return (
    <div className="glow-field flex flex-1 flex-col">
      <SiteNav />
      <ConnectExperience initialStep={4} />
    </div>
  );
}
