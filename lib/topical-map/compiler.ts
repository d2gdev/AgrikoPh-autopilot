import { parseCompilationContract, type CompilationContract } from "./contract";
import { validateCompilationContractIntegrity, type CompilationContractIntegrityResult } from "./contract-integrity";
import { resolveSourceLocator } from "./locator-resolver";
import { StrategyCompilerError, type RawStrategyPackage } from "./types";
import { normalizeGovernedUrl } from "./url-normalizer";

type ContractRule = CompilationContract["rules"][number];
type ContractCoverage = CompilationContract["coverageInventory"][number];
type RuleDomain = ContractRule["domain"];

export type CompiledSourceReference = ContractRule["sourceReferences"][number] & {
  resolved: { artifactId: ContractRule["sourceReferences"][number]["artifactId"]; lineStart: number; lineEnd: number };
};

export interface CompiledRule extends Omit<ContractRule, "sourceReferences" | "payload"> {
  contractRuleId: string;
  strategyVersion: string;
  packageSha256: string;
  payload: ContractRule["payload"];
  sourceReferences: CompiledSourceReference[];
}

export type CompiledCoverage = ContractCoverage & {
  resolved: { artifactId: ContractCoverage["artifactId"]; lineStart: number; lineEnd: number };
};

export interface CompiledStrategyPackage {
  strategyVersion: string;
  packageSha256: string;
  integrity: CompilationContractIntegrityResult;
  coverage: CompiledCoverage[];
  rules: CompiledRule[];
  byDomain: Record<RuleDomain, CompiledRule[]>;
}

function parseVerifiedContract(bytes: Buffer): CompilationContract {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes));
  } catch {
    throw new StrategyCompilerError("INVALID_COMPILATION_CONTRACT");
  }
  return parseCompilationContract(value);
}

function normalizePayload(payload: ContractRule["payload"]): ContractRule["payload"] {
  const copy = structuredClone(payload) as Record<string, unknown>;
  for (const key of ["currentUrl", "proposedCanonicalUrl", "exactTargetIfAny", "source", "configuredTarget", "finalTarget", "fromUrl", "toUrl"]) {
    if (typeof copy[key] === "string" && copy[key] !== "") copy[key] = normalizeGovernedUrl(copy[key]);
  }
  if (Array.isArray(copy.memberUrls)) copy.memberUrls = copy.memberUrls.map((url) => typeof url === "string" ? normalizeGovernedUrl(url) : url);
  return copy as ContractRule["payload"];
}

export function compileStrategyPackage(raw: RawStrategyPackage): CompiledStrategyPackage {
  const contract = parseVerifiedContract(raw.artifacts["compilation-contract"].bytes);
  const integrity = validateCompilationContractIntegrity({ rawPackage: raw, contract });
  const byDomain = Object.fromEntries([
    "clusters", "page_roles", "url_intent_ownership", "content_decisions", "prohibited_content", "internal_links", "redirects", "canonicalization", "indexation", "evidence_gates", "high_stakes_reviews",
  ].map((domain) => [domain, []])) as unknown as CompiledStrategyPackage["byDomain"];
  const coverage = contract.coverageInventory.map((item) => ({
    ...structuredClone(item),
    resolved: resolveSourceLocator({ artifactId: item.artifactId, bytes: raw.artifacts[item.artifactId].bytes, locator: item.locator }),
  }));
  const rules = contract.rules.map((rule) => {
    const compiled: CompiledRule = {
      ...structuredClone(rule),
      contractRuleId: rule.ruleId,
      strategyVersion: contract.strategyVersion,
      packageSha256: raw.packageSha256,
      payload: normalizePayload(rule.payload),
      sourceReferences: rule.sourceReferences.map((reference) => ({
        ...structuredClone(reference),
        resolved: resolveSourceLocator({ artifactId: reference.artifactId, bytes: raw.artifacts[reference.artifactId].bytes, locator: reference.locator }),
      })),
    };
    byDomain[compiled.domain].push(compiled);
    return compiled;
  });
  return { strategyVersion: contract.strategyVersion, packageSha256: raw.packageSha256, integrity, coverage, rules, byDomain };
}
