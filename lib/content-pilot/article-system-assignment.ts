export type ArticleSystemTemplate = "guide" | "comparison" | "buying-guide" | "recipe" | "farming-trust";
export type ArticleSystemProfile = "rice" | "turmeric" | "herbal" | "farming" | "recipe" | "general";

export interface ArticleSystemAssignmentInput {
  title: string;
  tags?: string[];
  blogHandle?: string | null;
  bodyHtml?: string | null;
  targetKeyword?: string | null;
  articleHandle?: string | null;
}

export interface ArticleSystemAssignment {
  template: ArticleSystemTemplate;
  profile: ArticleSystemProfile;
}

const RICE_RE = /\b(rice|black rice|red rice|brown rice|organic rice|whole grain|grain|grains|sinandomeng)\b/i;
const TURMERIC_RE = /\b(turmeric|dulaw|luyang dilaw|curcumin)\b/i;
const GENERIC_HERBAL_RE = /\b(herbal|herb|tea)\b/i;
const SPECIFIC_HERBAL_RE = /\b(pito[-\s]?pito|sambong|lagundi|moringa|malunggay|ginger|salabat|guyabano|tsaang gubat|lemongrass|pandan)\b/i;
const HERBAL_RE = /\b(herbal|herb|tea|pito[-\s]?pito|sambong|lagundi|moringa|malunggay|ginger|salabat|guyabano|tsaang gubat|lemongrass|pandan)\b/i;
const FARMING_RE = /\b(farming|farm|farms|organic agriculture|sustainable|regenerative|soil|pest|biodiversity|water conservation|sourcing|provenance)\b/i;
const RECIPE_RE = /\b(recipe|recipes|how to make|cook|cooking|brew|brewing|ingredients|preparation)\b/i;
const BUYING_RE = /\b(how to choose|where to buy|buying guide|best\s+.+\s+brands?|brands?\s+in\s+the\s+philippines|supplier|suppliers|options to buy)\b/i;
const COMPARISON_RE = /\b(vs\.?|versus|compare|comparison|which is better|difference between|black rice vs red rice|red rice vs black rice)\b/i;

const HANDLE_SUFFIX_MAP: Array<[RegExp, string]> = [
  [
    /turmeric-?tea-philippines-benefits-how-to-brew-and-best-options/i,
    "turmeric-tea-benefits-philippines",
  ],
  [
    /organic-rice-philippines-a-practical-guide-to-healthier-grains-from-local-farms/i,
    "health-benefits-organic-rice",
  ],
  [/pito-?pito-tea-philippines/i, "herbal-tea-recipes"],
  [/sambong-herb-philippines/i, "herbal-tea-recipes"],
  [/how-to-choose-the-best-black-rice-brands/i, "where-to-buy-organic-rice"],
  [/how-to-choose.*best.*rice.*brands/i, "where-to-buy-organic-rice"],
];

const TEXT_SUFFIX_MAP: Array<[RegExp, string]> = [
  [/\b(herbal|herb)\b|\bpito[-\s]?pito\b|\bpito-pito tea\b/i, "herbal-tea-recipes"],
  [/\bsambong\b/i, "herbal-tea-recipes"],
  [/\blagundi\b/i, "lagundi-herb-philippines"],
  [/\bmoringa\b|\bmalunggay\b/i, "moringa-superfood-guide"],
  [/\bsalabat\b|\bginger tea\b/i, "herbal-tea-recipes"],
  [/\bguyabano\b/i, "guyabano-health-benefits"],
  [/\bturmeric\b.*\bbenefit|\bbenefits\b.*\bturmeric\b/i, "turmeric-tea-benefits-philippines"],
  [/\bturmeric\b.*\bhow to brew|\bhow to brew\b.*\bturmeric\b/i, "turmeric-tea-benefits-philippines"],
  [/\bturmeric\b.*\bginger|\bginger\b.*\bturmeric\b/i, "turmeric-vs-ginger"],
  [/\bturmeric\b.*\binflammation|\binflammation\b.*\bturmeric\b/i, "turmeric-for-inflammation"],
  [/\bturmeric\b.*\bdosage|\bdosage\b.*\bturmeric\b|\bsafety\b.*\bturmeric\b/i, "turmeric-dosage-safety"],
  [/\bblack rice\b.*\bvs\b.*\bred rice|\bred rice\b.*\bvs\b.*\bblack rice/i, "black-rice-vs-red-rice"],
  [/\bcomparison\b|\bcomparison of\b|\bcompare\b|\bwhich is better\b/i, "rice-nutrition-breakdown"],
  [/\borganic rice\b.*\btypes|\btypes of\b.*\borganic rice/i, "types-of-organic-rice"],
  [/\bblack rice\b.*\bguide|\bred rice\b.*\bguide|\borganic rice\b.*\bbenefit/i, "health-benefits-organic-rice"],
  [/\bbuying\b|\bbrands\b|\bwhere to buy\b/i, "where-to-buy-organic-rice"],
  [/\bfuture of organic farming\b|\borganic farming\b/i, "future-of-organic-farming"],
];

function normalizeTags(tags: string[] | undefined): string {
  return (tags || []).filter(Boolean).join(" ");
}

function normalizeTag(tag: string): string {
  return tag.trim().toLowerCase().replace(/\s+/g, " ");
}

function addTag(tags: string[], tag: string): void {
  const normalized = normalizeTag(tag);
  if (normalized && !tags.includes(normalized)) tags.push(normalized);
}

function textEvidence(input: ArticleSystemAssignmentInput): string {
  return `${input.title || ""} ${input.targetKeyword || ""} ${normalizeTags(input.tags)} ${input.bodyHtml || ""}`;
}

function hasHerbalEvidence(text: string): boolean {
  return SPECIFIC_HERBAL_RE.test(text) || (GENERIC_HERBAL_RE.test(text) && !TURMERIC_RE.test(text));
}

export function resolveArticleSystemAssignment(input: ArticleSystemAssignmentInput): ArticleSystemAssignment {
  const title = input.title || "";
  const keywordText = input.targetKeyword || "";
  const tagText = normalizeTags(input.tags);
  const bodyText = input.bodyHtml || "";
  const allText = `${title} ${keywordText} ${tagText} ${bodyText}`;
  const blogHandle = input.blogHandle || "";
  const titleHasCategory = TURMERIC_RE.test(title) || RICE_RE.test(title) || hasHerbalEvidence(title) || FARMING_RE.test(title);
  const titleHasFarming = FARMING_RE.test(title);
  const tagCategoryCount = [
    TURMERIC_RE.test(tagText),
    RICE_RE.test(tagText),
    hasHerbalEvidence(tagText),
    FARMING_RE.test(tagText),
  ].filter(Boolean).length;

  let profile: ArticleSystemProfile = "general";
  if (blogHandle === "recipes") {
    profile = "recipe";
  } else if (titleHasFarming) {
    profile = "farming";
  } else if (TURMERIC_RE.test(title)) {
    profile = "turmeric";
  } else if (RICE_RE.test(title)) {
    profile = "rice";
  } else if (hasHerbalEvidence(title)) {
    profile = "herbal";
  } else if (FARMING_RE.test(title)) {
    profile = "farming";
  } else if (!titleHasCategory && tagCategoryCount > 1) {
    profile = "general";
  } else if (TURMERIC_RE.test(tagText)) {
    profile = "turmeric";
  } else if (RICE_RE.test(tagText)) {
    profile = "rice";
  } else if (hasHerbalEvidence(tagText)) {
    profile = "herbal";
  } else if (FARMING_RE.test(tagText)) {
    profile = "farming";
  } else if (TURMERIC_RE.test(keywordText)) {
    profile = "turmeric";
  } else if (RICE_RE.test(keywordText)) {
    profile = "rice";
  } else if (hasHerbalEvidence(keywordText)) {
    profile = "herbal";
  } else if (FARMING_RE.test(keywordText)) {
    profile = "farming";
  } else if (TURMERIC_RE.test(bodyText)) {
    profile = "turmeric";
  } else if (RICE_RE.test(bodyText)) {
    profile = "rice";
  } else if (hasHerbalEvidence(bodyText)) {
    profile = "herbal";
  } else if (FARMING_RE.test(bodyText)) {
    profile = "farming";
  }

  let template: ArticleSystemTemplate = "guide";
  if (profile === "recipe" || blogHandle === "recipes") {
    template = "recipe";
  } else if (COMPARISON_RE.test(allText)) {
    template = "comparison";
  } else if (BUYING_RE.test(title)) {
    template = "buying-guide";
  } else if (profile === "farming") {
    template = "farming-trust";
  } else if (RECIPE_RE.test(title) && blogHandle === "recipes") {
    template = "recipe";
  }

  return { template, profile };
}

export function resolveArticleTemplateSuffix(input: ArticleSystemAssignmentInput): string | null {
  const title = input.title || "";
  const handle = (input.articleHandle || "").toLowerCase();
  const keywordText = (input.targetKeyword || "").toLowerCase();
  const allText = `${title} ${keywordText} ${normalizeTags(input.tags)} ${input.bodyHtml || ""}`.toLowerCase();

  for (const [matcher, suffix] of HANDLE_SUFFIX_MAP) {
    if (matcher.test(handle)) return suffix;
  }

  for (const [matcher, suffix] of TEXT_SUFFIX_MAP) {
    if (matcher.test(allText)) return suffix;
  }

  const assignment = resolveArticleSystemAssignment(input);

  if (assignment.template === "recipe" || input.blogHandle === "recipes") {
    return "herbal-tea-recipes";
  }

  if (assignment.profile === "turmeric") {
    if (COMPARISON_RE.test(allText)) return "turmeric-vs-ginger";
    if (/complete guide|complete benefits|brew|best options|benefits|why/i.test(allText)) {
      return "turmeric-tea-benefits-philippines";
    }
    return "turmeric-tea-benefits-philippines";
  }

  if (assignment.profile === "herbal") {
    if (/lagundi/i.test(allText)) return "lagundi-herb-philippines";
    if (/moringa|malunggay/i.test(allText)) return "moringa-superfood-guide";
    if (/salabat|ginger/i.test(allText)) return "herbal-tea-recipes";
    return "herbal-tea-recipes";
  }

  if (assignment.profile === "rice") {
    if (COMPARISON_RE.test(allText)) return "black-rice-vs-red-rice";
    if (/\bbuying\b|\bchoose\b|\bbest brand\b|\bwhere to buy\b|\bbest options\b/i.test(allText)) {
      return "where-to-buy-organic-rice";
    }
    if (/\btypes of\b/i.test(allText)) return "types-of-organic-rice";
    if (/\bblack rice\b/i.test(allText)) return "black-rice-philippines";
    if (/\bred rice\b/i.test(allText)) return "red-rice-philippines";
  }

  if (assignment.profile === "farming" || assignment.template === "farming-trust") {
    return "sustainable-rice-farming";
  }

  if (assignment.profile === "recipe") {
    return "herbal-tea-recipes";
  }

  if (assignment.template === "comparison") {
    return "black-rice-vs-red-rice";
  }

  if (assignment.template === "buying-guide") {
    return "where-to-buy-organic-rice";
  }

  return null;
}

export function normalizeArticleSystemTags(input: ArticleSystemAssignmentInput): string[] {
  const assignment = resolveArticleSystemAssignment(input);
  const tags: string[] = [];
  for (const tag of input.tags || []) {
    if (tagMatchesProfile(tag, assignment.profile)) addTag(tags, tag);
  }

  const evidence = textEvidence(input);

  if (assignment.profile === "rice") {
    addTag(tags, "organic rice");
    addTag(tags, "organic rice philippines");
    if (/\bblack[-\s]?rice\b/i.test(evidence)) {
      addTag(tags, "black rice");
      addTag(tags, "rice-type:black-rice");
      addTag(tags, "organic black rice philippines");
    }
    if (/\bred[-\s]?rice\b/i.test(evidence)) {
      addTag(tags, "red rice");
      addTag(tags, "rice-type:red-rice");
      addTag(tags, "organic red rice philippines");
    }
    if (/\bbrown[-\s]?rice\b/i.test(evidence)) addTag(tags, "brown rice");
  } else if (assignment.profile === "turmeric") {
    addTag(tags, "turmeric");
    addTag(tags, "turmeric tea philippines");
  } else if (assignment.profile === "herbal") {
    addTag(tags, "filipino herbal wellness");
    if (/\bpito[-\s]?pito\b/i.test(evidence)) {
      addTag(tags, "pito-pito");
      addTag(tags, "pito-pito tea philippines");
    }
    if (/\bsambong\b/i.test(evidence)) addTag(tags, "sambong");
    if (/\blagundi\b/i.test(evidence)) addTag(tags, "lagundi");
    if (/\b(moringa|malunggay)\b/i.test(evidence)) addTag(tags, "moringa");
    if (/\b(ginger|salabat)\b/i.test(evidence)) addTag(tags, "ginger");
  } else if (assignment.profile === "farming") {
    addTag(tags, "organic farming");
    addTag(tags, "sustainable farming");
  } else if (assignment.profile === "recipe") {
    addTag(tags, "recipes");
  } else if (/\b(distributor|organic health products|health products)\b/i.test(evidence)) {
    addTag(tags, "organic health products");
  }

  if (assignment.template === "buying-guide") addTag(tags, "buying guide");
  if (assignment.template === "comparison") addTag(tags, "comparison");

  return tags;
}

function tagMatchesProfile(tag: string, profile: ArticleSystemProfile): boolean {
  const normalized = normalizeTag(tag);
  if (!normalized) return false;
  if (profile === "rice") return RICE_RE.test(normalized);
  if (profile === "turmeric") return TURMERIC_RE.test(normalized);
  if (profile === "herbal") return HERBAL_RE.test(normalized);
  if (profile === "farming") return FARMING_RE.test(normalized);
  if (profile === "recipe") return RECIPE_RE.test(normalized) || normalized === "recipes";
  return !RICE_RE.test(normalized) && !TURMERIC_RE.test(normalized) && !HERBAL_RE.test(normalized) && !FARMING_RE.test(normalized);
}

export function articleSystemMetafields(input: ArticleSystemAssignmentInput) {
  const assignment = resolveArticleSystemAssignment(input);
  return [
    {
      namespace: "custom",
      key: "article_system_template",
      value: assignment.template,
      type: "single_line_text_field",
    },
    {
      namespace: "custom",
      key: "article_system_profile",
      value: assignment.profile,
      type: "single_line_text_field",
    },
  ];
}
