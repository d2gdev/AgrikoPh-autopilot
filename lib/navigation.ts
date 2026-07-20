export interface EmbeddedNavigationItem {
  label: string;
  href: string;
  match: "exact" | "prefix";
  appBridge?: boolean;
}

export interface EmbeddedNavigationSection {
  title?: string;
  separator?: boolean;
  items: EmbeddedNavigationItem[];
}

export const EMBEDDED_NAVIGATION_SECTIONS: EmbeddedNavigationSection[] = [
  {
    items: [
      { label: "Dashboard", href: "/", match: "exact", appBridge: true },
    ],
  },
  {
    title: "Ad Pilot",
    separator: true,
    items: [
      { label: "Campaigns", href: "/campaigns", match: "prefix", appBridge: true },
      { label: "Recommendations", href: "/recommendations", match: "prefix", appBridge: true },
      { label: "Ad Approvals", href: "/ad-approvals", match: "prefix", appBridge: true },
      { label: "Report", href: "/ad-pilot", match: "exact" },
    ],
  },
  {
    title: "SEO Pilot",
    separator: true,
    items: [
      { label: "SEO", href: "/seo-pillar", match: "prefix", appBridge: true },
      { label: "Tasks", href: "/seo-tasks", match: "prefix", appBridge: true },
    ],
  },
  {
    title: "Store Pilot",
    separator: true,
    items: [
      { label: "Images", href: "/images", match: "prefix" },
      { label: "Report", href: "/store-pilot", match: "exact" },
    ],
  },
  {
    title: "Content Pilot",
    separator: true,
    items: [
      { label: "Content", href: "/content-pilot", match: "prefix", appBridge: true },
    ],
  },
  {
    title: "Social Pilot",
    separator: true,
    items: [
      { label: "Social", href: "/social-pilot", match: "prefix", appBridge: true },
    ],
  },
  {
    title: "Market Intelligence",
    separator: true,
    items: [
      { label: "Competitors", href: "/market-intelligence", match: "prefix", appBridge: true },
    ],
  },
  {
    title: "Insights Pilot",
    separator: true,
    items: [
      { label: "Growth Brief", href: "/growth-brief", match: "prefix" },
      { label: "Unified Report", href: "/insights", match: "prefix", appBridge: true },
    ],
  },
  {
    title: "Odysseus",
    separator: true,
    items: [
      { label: "Workspace", href: "/odysseus", match: "prefix" },
    ],
  },
  {
    separator: true,
    items: [
      { label: "Backlog", href: "/backlog", match: "prefix", appBridge: true },
      { label: "Settings", href: "/settings", match: "prefix", appBridge: true },
    ],
  },
];

export function matchesNavigationItem(pathname: string, item: EmbeddedNavigationItem): boolean {
  if (item.match === "exact") return pathname === item.href;
  if (item.href === "/images") return pathname.startsWith("/images") && pathname !== "/store-pilot";
  return pathname.startsWith(item.href);
}

export function getAppBridgeNavigationItems(): EmbeddedNavigationItem[] {
  return EMBEDDED_NAVIGATION_SECTIONS.flatMap((section) => section.items).filter((item) => item.appBridge);
}
