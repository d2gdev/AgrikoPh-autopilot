import type { TopicalMapCommandCenter } from "@/lib/topical-map/command-center";
import type { MapAwareSeoAnalysis } from "@/lib/seo/analysis";

export type MapIdentity = TopicalMapCommandCenter["identity"];

export type MapLoadState =
  | { state: "loading" }
  | { state: "no_active_strategy" }
  | { state: "error"; message: string }
  | { state: "ready"; generatedAt: string; commandCenter: TopicalMapCommandCenter };

export type MapAnalysisEnvelope = {
  analysis: MapAwareSeoAnalysis | null;
  generatedAt: string | null;
  strategy: MapIdentity | null;
};

export type MapAnalysisState =
  | { state: "loading"; analysis: null }
  | { state: "no_active_strategy"; analysis: null }
  | { state: "error"; analysis: null; message: string }
  | { state: "stale"; analysis: null }
  | { state: "empty"; analysis: null; generatedAt: string | null }
  | { state: "ready"; analysis: MapAwareSeoAnalysis };
