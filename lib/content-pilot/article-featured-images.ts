export interface ArticleFeaturedImage {
  url: string;
  altText: string;
}

interface ArticleImageInput {
  handle?: string | null;
  title?: string | null;
  tags?: string[] | null;
  blogHandle?: string | null;
}

interface ImageOptions {
  includeFallback?: boolean;
}

const IMAGES = {
  turmericRoot: {
    url: "https://cdn.shopify.com/s/files/1/0812/7306/1602/files/agriko-content-illust-wellness-turmeric-root.jpg?v=1780581804",
    altText: "Turmeric roots for Agriko wellness guides",
  },
  turmericInflammation: {
    url: "https://autopilot.agrikoph.com/generated/article-images/turmeric-inflammation-agriko.jpg",
    altText: "Turmeric tea, roots, and golden powder for inflammation support",
  },
  turmericDosage: {
    url: "https://autopilot.agrikoph.com/generated/article-images/turmeric-dosage-safety-agriko.jpg",
    altText: "Measured turmeric powder with tea and roots for dosage guidance",
  },
  turmericTea: {
    url: "https://cdn.shopify.com/s/files/1/0812/7306/1602/files/agriko-5n1-turmeric-tea-optimized.jpg?v=1781985291",
    altText: "Agriko turmeric tea blend with prepared tea and turmeric roots",
  },
  goldenTea: {
    url: "https://cdn.shopify.com/s/files/1/0812/7306/1602/files/agriko-content-illust-wellness-golden-tea.jpg?v=1780581780",
    altText: "Golden turmeric tea with roots and honey",
  },
  gingerTurmeric: {
    url: "https://cdn.shopify.com/s/files/1/0812/7306/1602/files/agriko-content-fresh-harvest-display.jpg?v=1780580737",
    altText: "Fresh ginger, turmeric, lemongrass, and harvest ingredients",
  },
  distributor: {
    url: "https://autopilot.agrikoph.com/generated/article-images/organic-health-products-distributor-agriko.jpg",
    altText: "Organic wellness ingredients and kraft pouches for distributor selection",
  },
  gingerTea: {
    url: "https://cdn.shopify.com/s/files/1/0812/7306/1602/files/agriko-ginger-tea-powder-blend-optimized.jpg?v=1781985295",
    altText: "Agriko ginger tea with prepared tea and ginger root",
  },
  brownRice: {
    url: "https://cdn.shopify.com/s/files/1/0812/7306/1602/files/agriko-content-illust-brown-rice.jpg?v=1780581877",
    altText: "Agriko brown rice with a Philippine rice field backdrop",
  },
  redRice: {
    url: "https://cdn.shopify.com/s/files/1/0812/7306/1602/files/agriko-content-illust-red-rice.jpg?v=1780581881",
    altText: "Agriko red rice with a Philippine rice field backdrop",
  },
  blackRice: {
    url: "https://cdn.shopify.com/s/files/1/0812/7306/1602/files/agriko-content-illust-black-rice.jpg?v=1780581872",
    altText: "Agriko black rice with a Philippine rice field backdrop",
  },
  riceTypes: {
    url: "https://cdn.shopify.com/s/files/1/0812/7306/1602/files/agriko-content-illust-rice-types.jpg?v=1780580670",
    altText: "Agriko organic rice varieties and grains",
  },
  herbalTea: {
    url: "https://cdn.shopify.com/s/files/1/0812/7306/1602/files/agriko-content-illust-wellness-tea.jpg?v=1780581795",
    altText: "Filipino herbal tea blend with teapot and cups",
  },
  herbalBlends: {
    url: "https://cdn.shopify.com/s/files/1/0812/7306/1602/files/agriko-content-illust-wellness-blends.jpg?v=1780581811",
    altText: "Agriko herbal wellness ingredients with mortar and pestle",
  },
  lagundi: {
    url: "https://autopilot.agrikoph.com/generated/article-images/lagundi-herb-philippines-agriko.jpg",
    altText: "Lagundi leaves, blossoms, and herbal tea in Agriko illustration style",
  },
  sambongV2: {
    url: "https://autopilot.agrikoph.com/generated/article-images/sambong-herb-philippines-v2.png",
    altText: "Sambong leaves and blossoms beside a warm cup of herbal tea",
  },
  herbalBlendsV2: {
    url: "https://autopilot.agrikoph.com/generated/article-images/creating-your-own-herbal-blends-v2.png",
    altText: "Mortar and pestle with dried herbs, roots, and botanicals for herbal blending",
  },
  riceBenefitsV2: {
    url: "https://autopilot.agrikoph.com/generated/article-images/organic-rice-benefits-v2.png",
    altText: "Bowl of mixed organic rice with fresh vegetables and rice stalks",
  },
  riceGuideV2: {
    url: "https://autopilot.agrikoph.com/generated/article-images/organic-rice-philippines-guide-v2.png",
    altText: "Baskets of Philippine organic rice varieties beside a rice field",
  },
  filipinoHerbalRemediesV2: {
    url: "https://autopilot.agrikoph.com/generated/article-images/filipino-herbal-remedies-v2.png",
    altText: "Filipino herbal remedies with lagundi, sambong, ginger, turmeric, moringa, and tea",
  },
  futureOrganicFarmingV2: {
    url: "https://autopilot.agrikoph.com/generated/article-images/future-organic-farming-philippines-v2.png",
    altText: "Philippine organic rice farm with healthy soil, water channels, and biodiversity",
  },
  turmericTeaBenefitsV2: {
    url: "https://autopilot.agrikoph.com/generated/article-images/turmeric-tea-benefits-philippines-v2.png",
    altText: "Turmeric tea with fresh turmeric, ginger, and calamansi on a Filipino veranda",
  },
  brownRicePhilippinesV2: {
    url: "https://autopilot.agrikoph.com/generated/article-images/organic-brown-rice-philippines-v2.png",
    altText: "Organic brown rice grains in a woven bilao with palay stalks and vegetables",
  },
  distributorPhilippinesV2: {
    url: "https://autopilot.agrikoph.com/generated/article-images/organic-health-products-distributor-philippines-v2.png",
    altText: "Filipino family receiving a basket of organic goods from a trusted distributor",
  },
  redRicePhilippinesV2: {
    url: "https://autopilot.agrikoph.com/generated/article-images/red-rice-philippines-buyers-guide-v2.png",
    altText: "Red rice grains pouring from a wooden scoop into a woven sack",
  },
  blackRicePhilippinesV2: {
    url: "https://autopilot.agrikoph.com/generated/article-images/black-rice-philippines-buyers-guide-v2.png",
    altText: "Filipino shopper scooping black rice from a woven market tray",
  },
  blackRiceBrandsV2: {
    url: "https://autopilot.agrikoph.com/generated/article-images/best-black-rice-brands-philippines-v2.png",
    altText: "Black rice samples in ceramic bowls being compared for grain quality",
  },
  organicRiceGuideV2: {
    url: "https://autopilot.agrikoph.com/generated/article-images/what-is-organic-rice-guide-v2.png",
    altText: "Organic rice paddy with healthy soil, clean water, ducks, and a farmer tending seedlings",
  },
  whereToBuyOrganicRiceV2: {
    url: "https://autopilot.agrikoph.com/generated/article-images/where-to-buy-organic-rice-philippines-v2.png",
    altText: "Farm-to-home organic rice buying scene with woven baskets and Philippine farm stand",
  },
  moringa: {
    url: "https://cdn.shopify.com/s/files/1/0812/7306/1602/files/agriko-content-illust-wellness-moringa.jpg?v=1780581791",
    altText: "Moringa leaves for Agriko wellness articles",
  },
  farming: {
    url: "https://cdn.shopify.com/s/files/1/0812/7306/1602/files/agriko-content-illust-farming-regenerative.jpg?v=1780581683",
    altText: "Agriko regenerative farming landscape",
  },
  default: {
    url: "https://cdn.shopify.com/s/files/1/0812/7306/1602/files/recharge-vitality-hero-1x.webp?v=1778368765",
    altText: "Agriko organic wellness products for Filipino families",
  },
} satisfies Record<string, ArticleFeaturedImage>;

const EXACT_IMAGES: Record<string, ArticleFeaturedImage> = {
  "turmeric-golden-milk-latte": IMAGES.goldenTea,
  "turmeric-tea-benefits-philippines": IMAGES.turmericTeaBenefitsV2,
  "turmeric-vs-ginger": IMAGES.gingerTurmeric,
  "turmeric-dosage-safety": IMAGES.turmericDosage,
  "turmeric-for-inflammation": IMAGES.turmericInflammation,
  "organic-brown-rice-philippines": IMAGES.brownRicePhilippinesV2,
  "red-rice-philippines": IMAGES.redRicePhilippinesV2,
  "black-rice-philippines": IMAGES.blackRicePhilippinesV2,
  "pito-pito-tea-philippines": IMAGES.herbalTea,
  "sambong-herb-philippines": IMAGES.sambongV2,
  "lagundi-herb-philippines": IMAGES.lagundi,
  "how-to-choose-an-organic-health-products-distributor-philippines-families-trust": IMAGES.distributorPhilippinesV2,
  "creating-your-own-herbal-blends": IMAGES.herbalBlendsV2,
  "organic-rice-benefits-why-philippine-organic-rice-is-a-smart-choice": IMAGES.riceBenefitsV2,
  "organic-rice-philippines-benefits-varieties-complete-nutrition-guide": IMAGES.riceGuideV2,
  "filipino-herbal-remedies": IMAGES.filipinoHerbalRemediesV2,
  "the-future-of-organic-farming-in-the-philippines": IMAGES.futureOrganicFarmingV2,
  "how-to-choose-the-best-black-rice-brands-in-the-philippines": IMAGES.blackRiceBrandsV2,
  "what-is-organic-rice-a-plain-language-guide": IMAGES.organicRiceGuideV2,
  "where-to-buy-organic-rice-in-the-philippines": IMAGES.whereToBuyOrganicRiceV2,
};

function normalize(value: string | null | undefined): string {
  return value?.toLowerCase().trim() ?? "";
}

function articleText(input: ArticleImageInput): string {
  return [
    input.handle,
    input.title,
    input.blogHandle,
    ...(input.tags ?? []),
  ]
    .map(normalize)
    .filter(Boolean)
    .join(" ");
}

export function getArticleFeaturedImage(
  input: ArticleImageInput,
  options: ImageOptions = {}
): ArticleFeaturedImage | null {
  const handle = normalize(input.handle);
  const exactImage = handle ? EXACT_IMAGES[handle] : undefined;
  if (exactImage) return exactImage;

  const text = articleText(input);
  if (!text) return options.includeFallback === false ? null : IMAGES.default;

  if (/\b(black[-\s]?rice|roasted[-\s]?black[-\s]?rice)\b/.test(text)) return IMAGES.blackRice;
  if (/\bred[-\s]?rice\b/.test(text)) return IMAGES.redRice;
  if (/\bbrown[-\s]?rice\b/.test(text)) return IMAGES.brownRice;
  if (/\b(rice|palay|heirloom[-\s]?grain)\b/.test(text)) return IMAGES.riceTypes;

  if (/\b(turmeric[-\s]?vs[-\s]?ginger|ginger[-\s]?vs[-\s]?turmeric)\b/.test(text)) {
    return IMAGES.gingerTurmeric;
  }
  if (/\b(golden[-\s]?milk|latte)\b/.test(text)) return IMAGES.goldenTea;
  if (/\b(turmeric[-\s]?tea|5[-\s]?in[-\s]?1|5n1)\b/.test(text)) return IMAGES.turmericTea;
  if (/\bturmeric\b/.test(text)) return IMAGES.turmericRoot;
  if (/\b(ginger|salabat)\b/.test(text)) return IMAGES.gingerTea;

  if (/\b(moringa|malunggay)\b/.test(text)) return IMAGES.moringa;
  if (/\b(pito[-\s]?pito|tea|herbal|wellness)\b/.test(text)) return IMAGES.herbalTea;
  if (/\b(lagundi|sambong|remed(y|ies)|blend)\b/.test(text)) return IMAGES.herbalBlends;

  if (/\b(distributor|organic[-\s]?health[-\s]?products|health[-\s]?products)\b/.test(text)) {
    return IMAGES.gingerTurmeric;
  }
  if (/\b(farm|farming|regenerative|soil|biodiversity)\b/.test(text)) return IMAGES.farming;

  return options.includeFallback === false ? null : IMAGES.default;
}
