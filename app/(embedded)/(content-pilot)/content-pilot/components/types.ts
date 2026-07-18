export interface ArticleRow {
  blogHandle: string;
  handle: string;
  title: string;
  publishedAt: string | null;
  wordCount: number;
  seoScore: number;
  seoIssues: string[];
  internalLinks: number;
  inboundCount: number;
  topics: string[];
}

export interface TopicCluster {
  topic: string;
  articleCount: number;
  keywordCount: number;
  gapScore: number;
}

export interface ContentMapSuggestion {
  candidateId: string;
  targetUrl: string;
  title: string;
  action: "create" | "refresh";
  priority: string;
  decision: string;
  ruleIds: string[];
}

export interface ContentMapResearchItem {
  targetUrl: string;
  title: string;
  priority: string;
  decision: string;
  reason: string;
  ruleIds: string[];
}

export interface ContentMapUpcomingPhase {
  taskId: string;
  title: string;
  targetUrl: string | null;
  action: "create" | "refresh";
  obligations: string;
  priority: string;
  earliestReviewAt: string;
  dueAt: string | null;
  phaseLabel: string | null;
  ruleIds: string[];
}

export interface ContentMapSuggestionsResponse {
  strategy: {
    versionId: string;
    packageSha256: string;
    analysisGeneratedAt: string | null;
  };
  currentWork: {
    status: "current" | "refresh_required";
    reason: string | null;
  };
  actionable: ContentMapSuggestion[];
  upcoming: ContentMapUpcomingPhase[];
  research: ContentMapResearchItem[];
}

export interface LinkGraphData {
  total: number;
  hubs: { blogHandle: string; handle: string; title: string; inboundCount: number; outboundLinks: number }[];
  orphans: { blogHandle: string; handle: string; title: string; inboundCount: number; outboundLinks: number }[];
  orphanCount: number;
}

export interface ContentProposal {
  id: string;
  createdAt: string;
  articleHandle: string | null;
  proposalType: string;
  changeType: string;
  priority: "P1" | "P2" | "P3";
  impact: string;
  effort: string;
  title: string;
  description: string;
  proposedState: Record<string, unknown>;
  sourceData?: Record<string, unknown>;
  status: "pending" | "approved" | "rejected";
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  draftStatus: string | null;
  draftError?: string | null;
  draftGeneratedAt: string | null;
  scheduledPublishAt?: string | null;
  draftContent?: Record<string, unknown> | null;
  publishedHandle?: string | null;
  shopifyArticleId?: string | null;
  bodyHtml?: string | null;
  baselineSeoScore?: number | null;
  followUpSeoScore?: number | null;
  followUpScoredAt?: string | null;
  publishWarning?: string | null;
  publishOperationId?: string | null;
  publishFinalizedAt?: string | null;
}
