"use client";

import { Select, Tabs, useBreakpoints } from "@shopify/polaris";
import styles from "./seo-pilot-responsive.module.css";

export interface SeoPilotTab {
  id: string;
  content: string;
}

export function SeoPilotNavigation({ tabs, selected, onSelect }: {
  tabs: SeoPilotTab[];
  selected: number;
  onSelect: (index: number) => void;
}) {
  const { xlUp } = useBreakpoints({ defaults: { xlUp: true } });

  if (xlUp) return <Tabs tabs={tabs} selected={selected} onSelect={onSelect} />;

  return (
    <div className={styles.navigation}>
      <Select
        label="SEO Pilot view"
        options={tabs.map((tab, index) => ({ label: tab.content, value: String(index) }))}
        value={String(selected)}
        onChange={(value) => onSelect(Number(value))}
      />
    </div>
  );
}
