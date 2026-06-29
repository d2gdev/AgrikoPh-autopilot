// Keyword strategy for agrikoph.com, captured from the June 2026 keyword
// research report (deep-research-report). This is curated, version-controlled
// data that backs the SEO Pilot "Strategy" tab. The proxy bands here are
// analyst estimates — they should be read alongside real GSC data once the
// targets are tracked. Replace bands with first-party data over time.

export type Band = "Very High" | "High" | "Medium to high" | "Medium" | "Low to medium" | "Low" | "Very low";
export type Intent = "Transactional" | "Commercial" | "Informational" | "Navigational";
export type PageType =
  | "Category hub"
  | "Category + product"
  | "Category page"
  | "Master category page"
  | "Product page"
  | "Blog post"
  | "Comparison blog post"
  | "Pillar guide";
export type Priority = "Very high" | "High" | "Medium";

export interface KeywordCluster {
  id: string;
  name: string;
  coreKeywords: string[];
  intent: string;
  why: string;
}

export interface PrimaryTarget {
  keyword: string;
  cluster: string;
  intent: Intent;
  tail: "Short" | "Mid" | "Long";
  volumeBand: Band;
  adsCompetition: "High" | "Medium" | "Low";
  cpc: Band;
  difficulty: Band;
  serpPattern: string;
  pageType: PageType;
  priority: Priority;
}

export interface SecondaryTarget {
  keyword: string;
  intent: Intent;
  tail: "Short" | "Mid" | "Long";
  volumeBand: Band;
  difficulty: Band;
  targetPage: string;
}

export interface RoadmapItem {
  month: string;
  title: string;
  intent: Intent;
  targetKeyword: string;
  format: string;
  primaryLinkTarget: string;
}

export const KEYWORD_CLUSTERS: KeywordCluster[] = [
  { id: "rice", name: "Rice commerce", coreKeywords: ["organic rice", "black rice", "red rice", "brown rice", "Filipino organic rice"], intent: "Commercial, transactional", why: "Closest match to Agriko's strongest existing products" },
  { id: "blends", name: "Herbal blends", coreKeywords: ["turmeric tea", "ginger tea", "5-in-1 turmeric", "cacao turmeric blend"], intent: "Commercial, transactional", why: "Strong Philippine wellness fit and SKU relevance" },
  { id: "powders", name: "Pure powders", coreKeywords: ["turmeric powder", "ginger powder", "moringa or malunggay powder", "blue ternate powder"], intent: "Commercial, transactional", why: "Best path to high-intent ingredient searches" },
  { id: "education", name: "Education & comparison", coreKeywords: ["benefits", "nutrition", "recipes", "store rice", "cook rice", "red vs black rice"], intent: "Informational, commercial", why: "Supports rankings and pre-purchase trust" },
  { id: "provenance", name: "Farm & provenance", coreKeywords: ["organic farming philippines", "sustainable rice farming", "mindanao organic farm"], intent: "Informational, navigational", why: "Builds brand authority and differentiates Agriko from resellers" },
  { id: "retail", name: "Location & retail", coreKeywords: ["where to buy", "find agriko", "delivery philippines", "online order"], intent: "Navigational, transactional", why: "Supports last-mile purchase intent" },
];

export const PRIMARY_TARGETS: PrimaryTarget[] = [
  { keyword: "organic black rice philippines", cluster: "rice", intent: "Transactional", tail: "Mid", volumeBand: "High", adsCompetition: "Medium", cpc: "Medium", difficulty: "Medium", serpPattern: "Shopping, product snippets, reviews, PAA", pageType: "Category + product", priority: "Very high" },
  { keyword: "black rice philippines", cluster: "rice", intent: "Commercial", tail: "Short", volumeBand: "High", adsCompetition: "Medium", cpc: "Medium", difficulty: "Medium to high", serpPattern: "Shopping, product snippets, PAA", pageType: "Category hub", priority: "Very high" },
  { keyword: "organic red rice philippines", cluster: "rice", intent: "Transactional", tail: "Mid", volumeBand: "Medium", adsCompetition: "Medium", cpc: "Medium", difficulty: "Medium", serpPattern: "Shopping, product snippets, reviews", pageType: "Category + product", priority: "Very high" },
  { keyword: "red rice philippines", cluster: "rice", intent: "Commercial", tail: "Short", volumeBand: "High", adsCompetition: "Medium", cpc: "Medium", difficulty: "Medium to high", serpPattern: "Shopping, product snippets, PAA", pageType: "Category hub", priority: "Very high" },
  { keyword: "organic rice philippines", cluster: "rice", intent: "Commercial", tail: "Short", volumeBand: "High", adsCompetition: "High", cpc: "High", difficulty: "High", serpPattern: "Shopping, local retail, PAA", pageType: "Master category page", priority: "High" },
  { keyword: "turmeric tea philippines", cluster: "blends", intent: "Transactional", tail: "Mid", volumeBand: "Medium", adsCompetition: "Medium", cpc: "Medium to high", difficulty: "Medium", serpPattern: "Shopping, product snippets, PAA, video", pageType: "Category page", priority: "Very high" },
  { keyword: "turmeric powder philippines", cluster: "powders", intent: "Transactional", tail: "Mid", volumeBand: "Medium to high", adsCompetition: "High", cpc: "High", difficulty: "Medium to high", serpPattern: "Shopping, product snippets, PAA", pageType: "Category + product", priority: "Very high" },
  { keyword: "moringa powder philippines", cluster: "powders", intent: "Transactional", tail: "Mid", volumeBand: "High", adsCompetition: "High", cpc: "High", difficulty: "High", serpPattern: "Shopping, product snippets, PAA", pageType: "Category page", priority: "High" },
  { keyword: "malunggay powder philippines", cluster: "powders", intent: "Transactional", tail: "Mid", volumeBand: "High", adsCompetition: "High", cpc: "High", difficulty: "Medium to high", serpPattern: "Shopping, product snippets, PAA", pageType: "Category page", priority: "Very high" },
  { keyword: "ginger powder philippines", cluster: "powders", intent: "Transactional", tail: "Mid", volumeBand: "Medium", adsCompetition: "Medium", cpc: "Medium", difficulty: "Medium", serpPattern: "Shopping, PAA", pageType: "Category + product", priority: "High" },
  { keyword: "pure turmeric powder", cluster: "powders", intent: "Transactional", tail: "Long", volumeBand: "Medium", adsCompetition: "Medium", cpc: "Medium", difficulty: "Medium", serpPattern: "Shopping, product snippets", pageType: "Product page", priority: "High" },
  { keyword: "pure ginger powder", cluster: "powders", intent: "Transactional", tail: "Long", volumeBand: "Low to medium", adsCompetition: "Medium", cpc: "Medium", difficulty: "Low to medium", serpPattern: "Shopping, product snippets", pageType: "Product page", priority: "High" },
  { keyword: "black rice benefits", cluster: "education", intent: "Informational", tail: "Long", volumeBand: "Medium", adsCompetition: "Low", cpc: "Low", difficulty: "Medium", serpPattern: "PAA, list articles, videos", pageType: "Blog post", priority: "High" },
  { keyword: "red rice benefits", cluster: "education", intent: "Informational", tail: "Long", volumeBand: "Medium", adsCompetition: "Low", cpc: "Low", difficulty: "Medium", serpPattern: "PAA, list articles, videos", pageType: "Blog post", priority: "High" },
  { keyword: "red rice vs black rice", cluster: "education", intent: "Commercial", tail: "Long", volumeBand: "Low to medium", adsCompetition: "Low", cpc: "Low", difficulty: "Low to medium", serpPattern: "Comparison articles, PAA, video", pageType: "Comparison blog post", priority: "Very high" },
];

export const SECONDARY_BANK: SecondaryTarget[] = [
  { keyword: "buy organic rice online philippines", intent: "Transactional", tail: "Long", volumeBand: "Medium", difficulty: "Medium", targetPage: "Rice category" },
  { keyword: "organic rice delivery philippines", intent: "Transactional", tail: "Long", volumeBand: "Low to medium", difficulty: "Low to medium", targetPage: "Shop or shipping page" },
  { keyword: "black rice price philippines", intent: "Transactional", tail: "Long", volumeBand: "Medium", difficulty: "Medium", targetPage: "Black rice product page" },
  { keyword: "red rice price philippines", intent: "Transactional", tail: "Long", volumeBand: "Medium", difficulty: "Medium", targetPage: "Red rice product page" },
  { keyword: "organic brown rice philippines", intent: "Transactional", tail: "Mid", volumeBand: "Medium", difficulty: "Medium", targetPage: "Rice collection" },
  { keyword: "organic white rice philippines", intent: "Transactional", tail: "Mid", volumeBand: "Low to medium", difficulty: "Medium", targetPage: "Rice collection" },
  { keyword: "black rice nutrition", intent: "Informational", tail: "Mid", volumeBand: "Medium", difficulty: "Medium", targetPage: "Blog guide" },
  { keyword: "red rice nutrition", intent: "Informational", tail: "Mid", volumeBand: "Medium", difficulty: "Medium", targetPage: "Blog guide" },
  { keyword: "organic rice benefits", intent: "Informational", tail: "Mid", volumeBand: "Medium", difficulty: "Medium to high", targetPage: "Pillar guide" },
  { keyword: "types of organic rice", intent: "Informational", tail: "Long", volumeBand: "Low to medium", difficulty: "Low", targetPage: "Blog guide" },
  { keyword: "how to cook black rice", intent: "Informational", tail: "Long", volumeBand: "Medium", difficulty: "Low to medium", targetPage: "Recipe or guide" },
  { keyword: "how to cook red rice", intent: "Informational", tail: "Long", volumeBand: "Medium", difficulty: "Low to medium", targetPage: "Recipe or guide" },
  { keyword: "black rice water ratio", intent: "Informational", tail: "Long", volumeBand: "Low to medium", difficulty: "Low", targetPage: "Blog guide" },
  { keyword: "red rice water ratio", intent: "Informational", tail: "Long", volumeBand: "Low to medium", difficulty: "Low", targetPage: "Blog guide" },
  { keyword: "how to store rice", intent: "Informational", tail: "Long", volumeBand: "High", difficulty: "Medium", targetPage: "Blog guide" },
  { keyword: "best way to store rice", intent: "Informational", tail: "Long", volumeBand: "Medium", difficulty: "Medium", targetPage: "Blog guide" },
  { keyword: "turmeric tea benefits", intent: "Informational", tail: "Long", volumeBand: "Medium", difficulty: "Medium", targetPage: "Blog guide" },
  { keyword: "how to make turmeric tea", intent: "Informational", tail: "Long", volumeBand: "Medium", difficulty: "Low to medium", targetPage: "Recipe guide" },
  { keyword: "ginger tea benefits", intent: "Informational", tail: "Long", volumeBand: "Medium", difficulty: "Medium", targetPage: "Blog guide" },
  { keyword: "ginger tea powder", intent: "Commercial", tail: "Mid", volumeBand: "Low to medium", difficulty: "Low to medium", targetPage: "Product page" },
  { keyword: "blue ternate powder philippines", intent: "Transactional", tail: "Long", volumeBand: "Low to medium", difficulty: "Low", targetPage: "Product page" },
  { keyword: "butterfly pea powder philippines", intent: "Transactional", tail: "Long", volumeBand: "Low to medium", difficulty: "Low to medium", targetPage: "Product page" },
  { keyword: "blue ternate benefits", intent: "Informational", tail: "Long", volumeBand: "Low", difficulty: "Low", targetPage: "Blog guide" },
  { keyword: "moringa benefits", intent: "Informational", tail: "Mid", volumeBand: "High", difficulty: "High", targetPage: "Blog guide" },
  { keyword: "malunggay benefits", intent: "Informational", tail: "Mid", volumeBand: "High", difficulty: "Medium to high", targetPage: "Blog guide" },
  { keyword: "guyabano health benefits", intent: "Informational", tail: "Long", volumeBand: "Medium", difficulty: "Medium", targetPage: "Blog guide" },
  { keyword: "herbal tea recipes", intent: "Informational", tail: "Mid", volumeBand: "Medium", difficulty: "Medium", targetPage: "Recipe blog post" },
  { keyword: "turmeric ginger moringa drink", intent: "Commercial", tail: "Long", volumeBand: "Low", difficulty: "Low", targetPage: "Blend product page" },
  { keyword: "cacao turmeric drink", intent: "Commercial", tail: "Long", volumeBand: "Low to medium", difficulty: "Low", targetPage: "Blend collection or product" },
  { keyword: "5 in 1 turmeric tea", intent: "Transactional", tail: "Long", volumeBand: "Low to medium", difficulty: "Low", targetPage: "Product page" },
  { keyword: "5 in 1 power shot", intent: "Transactional", tail: "Long", volumeBand: "Very low", difficulty: "Low", targetPage: "Product page" },
  { keyword: "roasted black rice drink", intent: "Commercial", tail: "Long", volumeBand: "Very low", difficulty: "Low", targetPage: "Product page" },
  { keyword: "organic honey philippines", intent: "Transactional", tail: "Mid", volumeBand: "Medium", difficulty: "Medium to high", targetPage: "Honey collection" },
  { keyword: "raw honey philippines", intent: "Transactional", tail: "Mid", volumeBand: "Medium", difficulty: "Medium to high", targetPage: "Honey product page" },
  { keyword: "organic kids cereal philippines", intent: "Transactional", tail: "Long", volumeBand: "Low", difficulty: "Low", targetPage: "Kids cereal page" },
  { keyword: "filipino organic farm", intent: "Navigational", tail: "Long", volumeBand: "Low", difficulty: "Low", targetPage: "About page" },
  { keyword: "mindanao organic farm", intent: "Navigational", tail: "Long", volumeBand: "Low", difficulty: "Low", targetPage: "About page" },
  { keyword: "sustainable rice farming philippines", intent: "Informational", tail: "Long", volumeBand: "Low to medium", difficulty: "Medium", targetPage: "Blog pillar" },
  { keyword: "natural pest management organic farm", intent: "Informational", tail: "Long", volumeBand: "Low", difficulty: "Low", targetPage: "Blog pillar" },
  { keyword: "biodiversity organic farming", intent: "Informational", tail: "Long", volumeBand: "Low", difficulty: "Low", targetPage: "Blog pillar" },
];

export const ROADMAP: RoadmapItem[] = [
  { month: "July", title: "Organic Black Rice in the Philippines", intent: "Transactional", targetKeyword: "organic black rice philippines", format: "Category page refresh or build", primaryLinkTarget: "Black rice product" },
  { month: "July", title: "Red Rice vs Black Rice", intent: "Commercial", targetKeyword: "red rice vs black rice", format: "Comparison guide", primaryLinkTarget: "Rice collection" },
  { month: "August", title: "Organic Red Rice in the Philippines", intent: "Transactional", targetKeyword: "organic red rice philippines", format: "Category page refresh or build", primaryLinkTarget: "Red rice product" },
  { month: "August", title: "How to Cook Black Rice", intent: "Informational", targetKeyword: "how to cook black rice", format: "Recipe or practical guide", primaryLinkTarget: "Black rice product" },
  { month: "September", title: "Turmeric Tea in the Philippines", intent: "Transactional", targetKeyword: "turmeric tea philippines", format: "Category page refresh or build", primaryLinkTarget: "Turmeric tea product" },
  { month: "September", title: "How to Make Turmeric Tea at Home", intent: "Informational", targetKeyword: "how to make turmeric tea", format: "Recipe guide", primaryLinkTarget: "Turmeric tea collection" },
  { month: "October", title: "Malunggay Powder in the Philippines", intent: "Transactional", targetKeyword: "malunggay powder philippines", format: "Category page", primaryLinkTarget: "Powder collection" },
  { month: "October", title: "Malunggay Benefits and Everyday Uses", intent: "Informational", targetKeyword: "malunggay benefits", format: "Ingredient guide", primaryLinkTarget: "Malunggay or moringa product" },
  { month: "November", title: "Turmeric Powder in the Philippines", intent: "Transactional", targetKeyword: "turmeric powder philippines", format: "Category page", primaryLinkTarget: "Pure turmeric product" },
  { month: "November", title: "Pure Ginger Powder Guide", intent: "Commercial", targetKeyword: "pure ginger powder", format: "Buyer's guide", primaryLinkTarget: "Pure ginger product" },
  { month: "December", title: "How to Store Rice", intent: "Informational", targetKeyword: "how to store rice", format: "Evergreen guide", primaryLinkTarget: "Rice collection" },
  { month: "December", title: "Sustainable Rice Farming in the Philippines", intent: "Informational", targetKeyword: "sustainable rice farming philippines", format: "Pillar article", primaryLinkTarget: "About page and rice category" },
];

export const ALL_PRIMARY_KEYWORDS = PRIMARY_TARGETS.map((t) => t.keyword);
