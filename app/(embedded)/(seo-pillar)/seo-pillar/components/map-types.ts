import type { TopicalMapCommandCenter } from "@/lib/topical-map/command-center";
import type { MapAwareSeoAnalysis } from "@/lib/seo/analysis";

export type MapIdentity = TopicalMapCommandCenter["identity"];

export type MapLoadState =
  | { state: "loading" }
  | { state: "no_active_strategy" }
  | { state: "error"; message: string }
  | { state: "ready"; generatedAt: string; commandCenter: TopicalMapCommandCenter };

export type MapAnalysisEnvelope =
  | { state: "ready"; analysis: MapAwareSeoAnalysis; generatedAt: string; strategy: MapIdentity }
  | { state: "empty"; analysis: null; generatedAt: null; strategy: MapIdentity }
  | { state: "strategy_identity_stale"; analysis: null; generatedAt: null; strategy: MapIdentity; cachedStrategy: { versionId: string; packageSha256: string } }
  | { state: "stale"; analysis: null; generatedAt: null; strategy: MapIdentity; cachedStrategy: { versionId: string; packageSha256: string } }
  | { state: "evidence_stale" | "observation_unavailable"; analysis: null; generatedAt: null; strategy: MapIdentity }
  | { state: "no_active_strategy"; analysis: null; generatedAt: null; strategy: null };

export type MapAnalysisState =
  | { state: "loading"; analysis: null }
  | { state: "no_active_strategy"; analysis: null }
  | { state: "error"; analysis: null; message: string }
  | { state: "strategy_identity_stale" | "evidence_stale" | "observation_unavailable"; analysis: null }
  | { state: "stale"; analysis: null }
  | { state: "empty"; analysis: null; generatedAt: string | null }
  | { state: "ready"; analysis: MapAwareSeoAnalysis; generatedAt: string };
