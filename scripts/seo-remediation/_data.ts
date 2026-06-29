/**
 * Single source of truth for the Agriko SEO/IA remediation.
 * Transcribed verbatim from the plan appendices
 * (docs/superpowers/plans/2026-06-24-agriko-seo-ia-remediation.md).
 * Edit values HERE; the executor scripts read from this file.
 */

/** Appendix B — Canonical / 301 redirect map. `path` is store-relative, no domain. */
export interface Redirect {
  id: string;
  from: string;
  to: string;
  reason: string;
}
export const REDIRECTS: Redirect[] = [
  { id: "R1", from: "/products/red-rice", to: "/products/philippines-organic-red-rice", reason: "Dead link (404) in rice posts" },
  { id: "R2", from: "/products/black-rice", to: "/products/philippines-organic-black-rice", reason: "Duplicate handle serving same product" },
  { id: "R3", from: "/products/organic-red-rice", to: "/products/philippines-organic-red-rice", reason: "Stray handle in guide-to-organic-rice" },
  { id: "R4", from: "/products/organic-black-rice", to: "/products/philippines-organic-black-rice", reason: "Stray handle" },
  { id: "R5", from: "/collections/filipino-organic-rice", to: "/collections/organic-rice", reason: "Near-duplicate collection" },
  { id: "R6", from: "/blogs/news/red-rice-from-the-philippines-benefits-cooking-tips-and-where-to-buy", to: "/blogs/news/red-rice-philippines", reason: "Near-duplicate red-rice article" },
  { id: "R7", from: "/pages/guide-to-organic-rice", to: "/blogs/news/organic-rice-philippines-benefits-varieties-complete-nutrition-guide", reason: "Duplicate organic-rice benefits guide" },
  // Brand-name typo redirects — retain search traffic landing on misspelled slug
  { id: "R8", from: "/agrimko", to: "/", reason: "Brand misspelling (agrimko) seen in GSC" },
  { id: "R9", from: "/agringko", to: "/", reason: "Brand misspelling (agringko) seen in GSC" },
  { id: "R10", from: "/agrinko", to: "/", reason: "Brand misspelling (agrinko) seen in GSC" },
];

/** Appendix C — product rename map. Handles NEVER change; only titles. */
export interface Rename {
  handle: string;
  newTitle: string;
}
export const RENAMES: Rename[] = [
  { handle: "5-in-1-turmeric-tea-powder", newTitle: "Organic 5-in-1 Turmeric Tea Blend" },
  { handle: "cacao-with-5n1-with-turmeric-blend", newTitle: "Organic 5-in-1 Turmeric Cacao Blend" },
  { handle: "roasted-black-rice", newTitle: "Roasted Black Rice 5-in-1 Tea Blend" },
  { handle: "turmeric-tea-powder-blend", newTitle: "Organic Turmeric Tea Blend" },
  { handle: "ginger-tea-powder-blend", newTitle: "Organic Ginger Tea Blend" },
  { handle: "pure-turmeric", newTitle: "Pure Turmeric Powder" },
  { handle: "pure-ginger", newTitle: "Pure Ginger Powder" },
  { handle: "5n1-power-shot", newTitle: "Organic 5-in-1 Power Shot" },
  { handle: "philippines-organic-black-rice", newTitle: "Organic Black Rice – 3kg" },
  { handle: "philippines-organic-red-rice", newTitle: "Organic Red Rice – 3kg" },
  // unchanged (reference pattern): pure-blue-ternate-powder, agribata-kids-cereal-mix, organic-pure-honey
];

/** The 2 rice handles whose Product JSON-LD is missing (theme fix, Task 2). */
export const RICE_HANDLES = ["philippines-organic-black-rice", "philippines-organic-red-rice"];

/** Boilerplate description to purge wherever it is used as a collection/page description. */
export const BOILERPLATE = "Small-batch turmeric and rice blends grown without chemicals, made for real Filipino homes.";

/**
 * Task 6 — collection plan.
 * keepers: get a unique description + SEO title + SEO meta description.
 * removeRicePadding: pull the 2 rice SKUs out of these collections.
 * noindex: set metafield seo.hidden = true (theme must honor it, Task 8).
 */
export interface CollectionSpec {
  handle: string;
  seoTitle: string;
  seoDescription: string;     // <=155 chars, used as meta description
  bodyHtml: string;           // unique on-page description (50-100 words)
}
export const COLLECTION_KEEPERS: CollectionSpec[] = [
  {
    handle: "organic-rice",
    seoTitle: "Organic Rice Philippines | Black & Red Heirloom Grains | Agriko",
    seoDescription: "Shop Agriko's organic black and red rice — heirloom grains grown chemical-free in Dumingag, Zamboanga del Sur. Antioxidant-rich, high-fibre, farm-direct.",
    bodyHtml:
      "<p>Agriko's organic rice is grown the way nature intended — chemical-free heirloom grains farmed in Dumingag, Zamboanga del Sur since 2016. Our antioxidant-rich black rice and fibre-rich, lower-GI red rice are milled in small batches and shipped farm-direct across the Philippines. Choose a variety below, or read our <a href=\"/blogs/news/black-rice-vs-red-rice-which-philippine-organic-rice\">black rice vs red rice</a> guide to pick the right grain for your kitchen.</p>",
  },
  {
    handle: "organic-blends",
    seoTitle: "Organic Herbal Tea Blends Philippines | Turmeric & Ginger | Agriko",
    seoDescription: "Farm-grown Filipino herbal tea blends — 5-in-1 turmeric, ginger and cacao. Caffeine-free, no fillers, made from Mindanao-grown herbs. Shop Agriko.",
    bodyHtml:
      "<p>Warming, caffeine-free herbal blends made from herbs grown on our Mindanao farm. Our signature 5-in-1 turmeric blend brings together turmeric, ginger, moringa, guyabano and lemongrass, alongside single-note ginger and turmeric teas. No fillers, no artificial flavours — just farm-sourced wellness in every cup.</p>",
  },
  {
    handle: "pure-powders",
    seoTitle: "Pure Single-Ingredient Powders | Turmeric, Ginger, Blue Ternate | Agriko",
    seoDescription: "Pure single-ingredient Filipino powders — turmeric (dulaw), ginger and butterfly-pea (blue ternate). Finely milled, farm-grown, no additives. Shop Agriko.",
    bodyHtml:
      "<p>Single-ingredient powders milled from farm-grown Filipino crops — nothing added. Use our pure turmeric (dulaw) and pure ginger for cooking, teas and daily wellness, or pure blue ternate (butterfly-pea) for a natural blue in drinks and recipes. Bold colour, honest flavour, no fillers.</p>",
  },
  {
    handle: "organic-honey",
    seoTitle: "Organic Pure Honey Philippines | Raw Farm-Sourced | Agriko",
    seoDescription: "Agriko organic pure honey — smooth, raw, responsibly farm-sourced Filipino honey for teas, recipes and daily wellness. Shop farm-direct.",
    bodyHtml:
      "<p>Smooth, rich, responsibly farm-sourced pure honey — a natural sweetener for your teas, recipes and daily wellness routines. Pairs perfectly with our turmeric and ginger blends.</p>",
  },
];
/** Collections to strip the 2 rice SKUs out of (rice belongs only in organic-rice / shop-all). */
export const REMOVE_RICE_PADDING = ["organic-blends", "powders", "pure-powders", "kids-cereal", "organic-honey"];
/** Thin/merchandising collections to noindex via metafield until they have >=3 real SKUs. */
export const NOINDEX_COLLECTIONS = ["home-page-featured", "kids-cereal", "powders"];
/** Metafield used to flag noindex; theme article/collection head must honor it (Task 8). */
export const NOINDEX_METAFIELD = { namespace: "seo", key: "hidden", type: "boolean" as const };

/**
 * Appendix D — turmeric content cluster. Bodies live in ./content/<handle>.html.
 * blog: which blog the article belongs to ("news" or "recipes").
 */
export interface TurmericPost {
  handle: string;
  blog: "news" | "recipes";
  title: string;       // on-page H1 / article title
  seoTitle: string;    // <title> tag
  seoDescription: string;
  summaryHtml: string; // excerpt
  tags: string[];
}
export const TURMERIC_POSTS: TurmericPost[] = [
  {
    handle: "turmeric-golden-milk-latte",
    blog: "recipes",
    title: "Golden Milk: A Warm Turmeric Latte Recipe",
    seoTitle: "Golden Milk Recipe: Filipino Turmeric Latte | Agriko",
    seoDescription: "Make creamy golden milk at home with Agriko pure turmeric and 5-in-1 blend. A warming, caffeine-free Filipino turmeric latte recipe in minutes.",
    summaryHtml: "<p>A warming, caffeine-free turmeric latte you can make in minutes — with a dairy-free option.</p>",
    tags: ["turmeric", "recipe", "golden milk", "latte"],
  },
  {
    handle: "turmeric-tea-benefits-philippines",
    blog: "news",
    title: "Turmeric Tea Benefits: Why Filipinos Are Brewing Daily",
    seoTitle: "Turmeric Tea Benefits: A Filipino Wellness Guide | Agriko",
    seoDescription: "Discover the benefits of turmeric tea, how it compares to salabat, and how to brew Agriko's 5-in-1 blend for a daily Filipino wellness ritual.",
    summaryHtml: "<p>What's in a cup of turmeric tea, the evidence behind it, and how to brew it the Filipino way.</p>",
    tags: ["turmeric", "tea", "wellness"],
  },
  {
    handle: "turmeric-vs-ginger",
    blog: "news",
    title: "Turmeric vs Ginger: How They Compare",
    seoTitle: "Turmeric vs Ginger: Benefits, Uses & Which to Choose | Agriko",
    seoDescription: "Turmeric vs ginger — compare benefits, active compounds, and uses, and learn why you don't have to choose. A practical Filipino guide from Agriko.",
    summaryHtml: "<p>Curcumin vs gingerol, benefits head-to-head, and why our 5-in-1 blend gives you both.</p>",
    tags: ["turmeric", "ginger", "comparison"],
  },
  {
    handle: "turmeric-dosage-safety",
    blog: "news",
    title: "How Much Turmeric Per Day? A Practical Dosage Guide",
    seoTitle: "How Much Turmeric Per Day? Dosage & Safety Guide | Agriko",
    seoDescription: "How much turmeric per day is enough? A practical guide to turmeric dosage, who should be cautious, side effects, and the best time to take it.",
    summaryHtml: "<p>Recommended daily amounts, who should be cautious, and how to take turmeric safely.</p>",
    tags: ["turmeric", "dosage", "safety", "faq"],
  },
  {
    handle: "turmeric-for-inflammation",
    blog: "news",
    title: "Turmeric for Inflammation: Uses, Evidence, and How to Take It",
    seoTitle: "Turmeric for Inflammation: What the Evidence Says | Agriko",
    seoDescription: "How turmeric and curcumin may help with inflammation — the evidence, daily routines, and the best Agriko forms to take. A practical Filipino guide.",
    summaryHtml: "<p>How curcumin works, what the evidence says, and the everyday forms that fit your routine.</p>",
    tags: ["turmeric", "inflammation", "wellness"],
  },
];

// ---------------------------------------------------------------------------
// Task 10 — Internal link injection
// ---------------------------------------------------------------------------

/**
 * Each plan targets one article (by blog handle + article handle) and
 * specifies a list of product links to inject as a "Related products" block.
 * The block is idempotent: the script checks for the marker comment before
 * inserting and skips if it already exists.
 */
export interface InternalLinkPlan {
  blogHandle: string;
  articleHandle: string;
  /** Short label used in script output. */
  label: string;
  links: Array<{
    url: string;    // store-relative, e.g. /products/philippines-organic-red-rice
    text: string;   // anchor display text
    blurb: string;  // one-phrase description shown after the link
  }>;
}

export const INTERNAL_LINK_PLANS: InternalLinkPlan[] = [
  {
    blogHandle: "news",
    articleHandle: "health-benefits-organic-rice",
    label: "health-benefits-organic-rice",
    links: [
      {
        url: "/products/philippines-organic-red-rice",
        text: "Organic Red Rice – 3kg",
        blurb: "farm-grown in Mindanao, rich in antioxidants",
      },
      {
        url: "/products/philippines-organic-black-rice",
        text: "Organic Black Rice – 3kg",
        blurb: "heirloom variety, high in anthocyanins",
      },
    ],
  },
  {
    blogHandle: "news",
    articleHandle: "organic-rice-philippines-benefits-varieties-complete-nutrition-guide",
    label: "organic-rice-guide",
    links: [
      {
        url: "/products/philippines-organic-red-rice",
        text: "Organic Red Rice – 3kg",
        blurb: "farm-grown in Mindanao, rich in antioxidants",
      },
      {
        url: "/products/philippines-organic-black-rice",
        text: "Organic Black Rice – 3kg",
        blurb: "heirloom variety, high in anthocyanins",
      },
    ],
  },
  {
    blogHandle: "news",
    articleHandle: "red-rice-philippines",
    label: "red-rice-philippines",
    links: [
      {
        url: "/products/philippines-organic-red-rice",
        text: "Organic Red Rice – 3kg",
        blurb: "farm-grown in Mindanao, rich in antioxidants",
      },
      {
        url: "/products/philippines-organic-black-rice",
        text: "Organic Black Rice – 3kg",
        blurb: "pairs well — try both rice varieties",
      },
    ],
  },
];

// ---------------------------------------------------------------------------

/** Task 9 — wrong-market post to rewrite into PH-English brown-rice intent. */
export const BERAS_POST = {
  oldHandle: "why-choose-beras-coklat-organik-your-guide-to-organic-brown-rice",
  newHandle: "organic-brown-rice-philippines",
  blog: "news" as const,
  title: "Organic Brown Rice in the Philippines: Benefits & Where to Buy",
  seoTitle: "Organic Brown Rice Philippines: Benefits & Where to Buy | Agriko",
  seoDescription: "A plain-English guide to organic brown rice in the Philippines — benefits, how it compares to white and red rice, and where to buy farm-direct.",
};
