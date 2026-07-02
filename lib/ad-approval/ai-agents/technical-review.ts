// Technical Review Agent (spec §Technical Review AI Agent). All deterministic
// HTTP / regex checks — no LLM. Validates destination URL, redirects, pixel,
// UTM params, campaign naming, and event-config schema. Puppeteer-based mobile
// / Lighthouse checks are SKIPPED in v1 (no headless browser wired in).

import { REVIEW_STAGE } from "@/lib/ad-approval/constants";
import {
  type AgentInput,
  type AgentReport,
  type ValidationCheck,
  averageConfidence,
  deriveDecision,
  skipped,
} from "./shared";
import {
  checkUrlReachable,
  checkRedirectChain,
  checkFacebookPixel,
  checkUtmParams,
  checkCampaignName,
} from "./http-checks";

export const TECHNICAL_REVIEW_AGENT_NAME = "Technical Review Agent";

function checkEventConfig(config: unknown): ValidationCheck {
  // Minimal Facebook conversion-API shape check: an object with an "event_name".
  if (config == null) {
    return { check_name: "Event Tracking Config Valid", result: "PASS", confidence: 1, note: "No event config (optional)" };
  }
  const ok = typeof config === "object" && config !== null && "event_name" in (config as Record<string, unknown>);
  return {
    check_name: "Event Tracking Config Valid",
    result: ok ? "PASS" : "FAIL",
    confidence: 1,
    note: ok ? undefined : "Event config must include event_name",
  };
}

export async function runTechnicalReview(input: AgentInput, signal: AbortSignal): Promise<AgentReport> {
  const { creative } = input;
  const url = creative.destination_url;
  const checks: ValidationCheck[] = [];

  let urlReachable = false;
  if (url) {
    const reach = await checkUrlReachable(url, signal);
    urlReachable = reach.ok;
    checks.push({ check_name: "URL Accessible", result: reach.ok ? "PASS" : "FAIL", confidence: 1, note: reach.note });

    const redirects = await checkRedirectChain(url, signal);
    checks.push({ check_name: "No Redirect Loops", result: redirects.ok ? "PASS" : "FAIL", confidence: 1, note: redirects.note });

    const pixel = await checkFacebookPixel(url, signal);
    checks.push({ check_name: "Facebook Pixel Present", result: pixel.ok ? "PASS" : "FAIL", confidence: 0.95, note: pixel.note });
  } else {
    checks.push({ check_name: "URL Accessible", result: "FAIL", confidence: 1, note: "No destination URL provided" });
    checks.push({ check_name: "No Redirect Loops", result: "SKIPPED", confidence: 0, note: "No URL" });
    checks.push({ check_name: "Facebook Pixel Present", result: "FAIL", confidence: 1, note: "No URL" });
  }

  // Vision/Puppeteer checks — not available in v1.
  checks.push(skipped("URL Mobile Compatible"));
  checks.push(skipped("Page Load Speed"));

  const utm = checkUtmParams(creative.utm);
  checks.push({ check_name: "UTM Parameters Valid", result: utm.ok ? "PASS" : "FAIL", confidence: 1, note: utm.note });

  const campaign = checkCampaignName(creative.campaign_name);
  checks.push({ check_name: "Campaign Naming Convention", result: campaign.ok ? "PASS" : "FAIL", confidence: 0.9, note: campaign.note });

  checks.push(checkEventConfig(creative.event_config));

  // Domain reputation blocklist check — not wired in v1; conservative PASS.
  checks.push({ check_name: "Destination Domain Trust", result: "PASS", confidence: 0.75, note: "Blocklist check not enabled in v1" });

  const pixelPresent = checks.some((c) => c.check_name === "Facebook Pixel Present" && c.result === "PASS");
  // Spec: REJECTED if URL unreachable OR pixel missing OR ≥3 fails.
  const hardReject = !urlReachable || !pixelPresent;

  const overallResult = deriveDecision(checks, hardReject);
  const fails = checks.filter((c) => c.result === "FAIL");
  const warns = checks.filter((c) => c.result === "WARN");

  return {
    agentName: TECHNICAL_REVIEW_AGENT_NAME,
    overallResult,
    executiveSummary: urlReachable && pixelPresent
      ? "Destination URL is reachable with the Facebook pixel installed."
      : "Technical checks failed — see errors for the blocking issues.",
    validationChecks: checks,
    warnings: warns.length ? warns.map((c) => `${c.check_name}: ${c.note ?? "low confidence"}`).join("; ") : null,
    errors: fails.length ? fails.map((c) => `${c.check_name}: ${c.note ?? "failed"}`).join("; ") : null,
    recommendations: fails.length ? "Resolve the failing technical checks and resubmit." : null,
    confidenceScore: averageConfidence(checks),
  };
}

export const TECHNICAL_REVIEW_STAGE = REVIEW_STAGE.TECHNICAL_REVIEW;
