"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/** Every RD page uses the homepage workbench; direct visits return to its menu. */
export function WorkbenchShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const embedded = searchParams.get("embed") === "1";
  useEffect(() => {
    if (embedded) return;
    const section = pathname.startsWith("/projects") ? "rd-platforms"
      : pathname.startsWith("/scenario") ? "rd-assistant"
      : pathname.startsWith("/rd-cost/analysis") ? "rd-analysis" : "rd-calculation";
    window.location.replace(`/?section=${section}`);
  }, [embedded, pathname]);
  return embedded ? <div className="rd-embed">{children}</div> : <p>正在打开统一工作台…</p>;
}
