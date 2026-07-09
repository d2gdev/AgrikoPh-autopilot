export type ArticleSystemTemplate = "guide" | "comparison" | "buying-guide" | "recipe" | "farming-trust";
export type ArticleSystemProfile = "rice" | "turmeric" | "herbal" | "farming" | "recipe" | "general";

export interface ArticleSystemAssignmentInput {
  title: string;
  tags?: string[];
  blogHandle?: string | null;
  bodyHtml?: string | null;
  targetKeyword?: string | null;
}

export interface ArticleSystemAssignment {
  template: ArticleSystemTemplate;
  profile: ArticleSystemProfile;
}

const RICE_RE = /\b(rice|black rice|red rice|brown rice|organic rice|whole grain|grain|grains|sinandomeng)\b/i;
const TURMERIC_RE = /\b(turmeric|dulaw|luyang dilaw|curcumin)\b/i;
const HERBAL_RE = /\b(herbal|herb|tea|pito[-\s]?pito|sambong|lagundi|moringa|malunggay|ginger|salabat|guyabano|tsaang gubat|lemongrass|pandan)\b/i;
const FARMING_RE = /\b(farming|farm|farms|organic agriculture|sustainable|regenerative|soil|pest|biodiversity|water conservation|sourcing|provenance)\b/i;
const RECIPE_RE = /\b(recipe|recipes|how to make|cook|cooking|brew|brewing|ingredients|preparation)\b/i;
const BUYING_RE = /\b(how to choose|where to buy|buying guide|best\s+.+\s+brands?|brands?\s+in\s+the\s+philippines|supplier|suppliers|options to buy)\b/i;
const COMPARISON_RE = /\b(vs\.?|versus|compare|comparison|which is better|difference between|black rice vs red rice|red rice vs black rice)\b/i;

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

export function resolveArticleSystemAssignment(input: ArticleSystemAssignmentInput): ArticleSystemAssignment {
  const title = input.title || "";
  const keywordText = input.targetKeyword || "";
  const tagText = normalizeTags(input.tags);
  const bodyText = input.bodyHtml || "";
  const allText = `${title} ${keywordText} ${tagText} ${bodyText}`;
  const blogHandle = input.blogHandle || "";
  const titleHasCategory = TURMERIC_RE.test(title) || RICE_RE.test(title) || HERBAL_RE.test(title) || FARMING_RE.test(title);
  const titleHasFarming = FARMING_RE.test(title);
  const tagCategoryCount = [
    TURMERIC_RE.test(tagText),
    RICE_RE.test(tagText),
    HERBAL_RE.test(tagText),
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
  } else if (HERBAL_RE.test(title)) {
    profile = "herbal";
  } else if (FARMING_RE.test(title)) {
    profile = "farming";
  } else if (!titleHasCategory && tagCategoryCount > 1) {
    profile = "general";
  } else if (TURMERIC_RE.test(tagText)) {
    profile = "turmeric";
  } else if (RICE_RE.test(tagText)) {
    profile = "rice";
  } else if (HERBAL_RE.test(tagText)) {
    profile = "herbal";
  } else if (FARMING_RE.test(tagText)) {
    profile = "farming";
  } else if (TURMERIC_RE.test(bodyText)) {
    profile = "turmeric";
  } else if (RICE_RE.test(bodyText)) {
    profile = "rice";
  } else if (HERBAL_RE.test(bodyText)) {
    profile = "herbal";
  } else if (FARMING_RE.test(bodyText)) {
    profile = "farming";
  } else if (TURMERIC_RE.test(keywordText)) {
    profile = "turmeric";
  } else if (RICE_RE.test(keywordText)) {
    profile = "rice";
  } else if (HERBAL_RE.test(keywordText)) {
    profile = "herbal";
  } else if (FARMING_RE.test(keywordText)) {
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
  if (profile === "rice") return RICE_RE.test(normalized) || (!TURMERIC_RE.test(normalized) && !HERBAL_RE.test(normalized) && !FARMING_RE.test(normalized));
  if (profile === "turmeric") return TURMERIC_RE.test(normalized) || (!RICE_RE.test(normalized) && !HERBAL_RE.test(normalized) && !FARMING_RE.test(normalized));
  if (profile === "herbal") return HERBAL_RE.test(normalized) || (!RICE_RE.test(normalized) && !TURMERIC_RE.test(normalized) && !FARMING_RE.test(normalized));
  if (profile === "farming") return FARMING_RE.test(normalized) || (!RICE_RE.test(normalized) && !TURMERIC_RE.test(normalized) && !HERBAL_RE.test(normalized));
  if (profile === "recipe") return RECIPE_RE.test(normalized) || normalized === "recipes" || (!RICE_RE.test(normalized) && !TURMERIC_RE.test(normalized) && !HERBAL_RE.test(normalized) && !FARMING_RE.test(normalized));
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
