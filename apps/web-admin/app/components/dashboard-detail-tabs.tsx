"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { usePathname, useRouter } from "@/i18n/navigation";

import { Tabs } from "@/components/ui/tabs";

type DashboardDetailTabsProps = {
  children: React.ReactNode;
  className?: string;
  value: string;
};

export function DashboardDetailTabs({ children, className, value }: DashboardDetailTabsProps) {
  const router = useRouter();
  const pathname = usePathname() ?? "/";
  const searchParams = useSearchParams() ?? new URLSearchParams();
  const [currentTab, setCurrentTab] = React.useState(value);

  React.useEffect(() => {
    setCurrentTab(value);
  }, [value]);

  return (
    <Tabs
      className={className}
      onValueChange={(nextTab) => {
        if (nextTab === currentTab) {
          return;
        }

        setCurrentTab(nextTab);

        const params = new URLSearchParams(searchParams.toString());
        if (nextTab === "overview") {
          params.delete("tab");
        } else {
          params.set("tab", nextTab);
        }

        const nextQuery = params.toString();
        const hash = typeof window === "undefined" ? "" : window.location.hash;
        router.replace(`${pathname}${nextQuery ? `?${nextQuery}` : ""}${hash}`, { scroll: false });
      }}
      value={currentTab}
    >
      {children}
    </Tabs>
  );
}
