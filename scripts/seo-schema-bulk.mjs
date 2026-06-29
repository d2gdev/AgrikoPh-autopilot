/**
 * Bulk SEO + JSON-LD schema for all Agriko blog articles.
 *
 * Recipe articles  → Recipe schema (parsed ingredients + instructions, times via DeepSeek)
 * Informational    → Article + FAQPage schema (English FAQs via DeepSeek)
 *
 * Usage:
 *   node scripts/seo-schema-bulk.mjs                         # all articles
 *   node scripts/seo-schema-bulk.mjs --handles "h1,h2,h3"   # specific handles
 *   node scripts/seo-schema-bulk.mjs --handle single-handle
 *   node scripts/seo-schema-bulk.mjs --force                 # re-process articles that already have schema
 *   node scripts/seo-schema-bulk.mjs --dry-run
 */

import dotenv from 'dotenv';
import { parse as parseHtml } from 'node-html-parser';
import pLimit from 'p-limit';
import OpenAI from 'openai';
import process from 'process';

dotenv.config({ path: '.env' });

const DRY_RUN   = process.argv.includes('--dry-run');
const FORCE     = process.argv.includes('--force');

let targetHandles = null;
if (process.argv.includes('--handle')) {
  targetHandles = new Set([process.argv[process.argv.indexOf('--handle') + 1]]);
}
if (process.argv.includes('--handles')) {
  targetHandles = new Set(
    process.argv[process.argv.indexOf('--handles') + 1].split(',').map(h => h.trim())
  );
}

const STORE = process.env.SHOPIFY_STORE_DOMAIN;
const TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
const GQL   = `https://${STORE}/admin/api/2025-01/graphql.json`;

const deepseek = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: 'https://api.deepseek.com',
});

// ── Article categorisation ────────────────────────────────────────────────────

const RECIPE_HANDLES = new Set([
  'black-rice-nasi-goreng','black-sticky-rice-with-fresh-mango','black-rice-taho-parfait',
  'black-rice-pancit-style-stir-fry','black-rice-and-leche-flan-stack','black-rice-adobo-fried-rice',
  'black-rice-with-coconut-milk-and-latik','ginataang-black-rice','black-rice-kakanin',
  'black-rice-arroz-caldo','black-rice-bibingka','black-rice-puto','black-rice-sinangag',
  'black-rice-lugaw','black-rice-suman','black-rice-champorado','black-rice-biko',
  'black-rice-risotto-with-wild-mushrooms','black-rice-poke-bowl','black-rice-congee-with-century-egg',
  'black-rice-onigiri','black-rice-bibimbap','black-rice-grain-bowl-with-tahini',
  'black-rice-stuffed-bell-peppers','black-rice-tabbouleh','black-rice-arancini','black-rice-paella',
  'black-rice-with-citrus-glazed-salmon','black-rice-and-edamame-salad','black-rice-and-roasted-beet-salad',
  'black-rice-buddha-bowl','black-rice-salad-with-roasted-vegetables',
  'black-rice-with-coconut-curry-chicken','black-rice-and-garlic-shrimp-stir-fry',
  'black-rice-and-lentil-soup','black-rice-croquettes','black-rice-with-pan-seared-duck-breast',
  'black-rice-stuffed-portobello-mushrooms','black-rice-with-braised-short-ribs',
  'black-rice-and-black-bean-burrito-bowl','black-rice-smoothie-bowl',
  'black-rice-and-quinoa-power-bowl','black-rice-miso-soup','black-rice-breakfast-bowl-with-berries',
  'black-rice-energy-balls','black-rice-flour-chocolate-cake','black-rice-pancakes-with-coconut-syrup',
  'black-rice-pilaf-with-herbs','black-rice-pudding-with-vanilla-bean','black-rice-horchata',
  'red-rice-and-oat-energy-balls','red-rice-stuffed-portobello-mushrooms',
  'red-rice-breakfast-bowl-with-fresh-berries','red-rice-and-garlic-shrimp-stir-fry',
  'red-rice-pilaf-with-fresh-herbs','red-rice-and-lentil-soup','red-rice-with-coconut-curry-chicken',
  'red-rice-grain-bowl-with-tahini-dressing','red-rice-buddha-bowl',
  'red-rice-salad-with-roasted-vegetables','red-rice-stuffed-bell-peppers','red-rice-tabbouleh',
  'red-rice-bibimbap','red-rice-risotto-with-sun-dried-tomato','red-rice-paella',
  'red-rice-congee-with-ginger-and-scallion','red-rice-biko','red-rice-with-sinigang',
  'red-rice-nasi-goreng','red-rice-ginataang-mais','red-rice-champorado','red-rice-arroz-caldo',
  'red-rice-adobo-fried-rice','red-rice-lugaw','red-rice-sinangag',
  'salabat-recipe-how-to-make-traditional-filipino-ginger-tea',
  'turmeric-golden-milk-latte',
]);

// ── Shopify helpers ───────────────────────────────────────────────────────────

const shopifyLimit = pLimit(3);
const aiLimit      = pLimit(5);

async function gql(query, variables = {}) {
  const res = await fetch(GQL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': TOKEN },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Shopify HTTP ${res.status}`);
  const json = await res.json();
  if (json.errors?.length) throw new Error(json.errors.map(e => e.message).join('; '));
  return json.data;
}

async function fetchAllArticles() {
  const articles = [];
  let cursor = null;
  do {
    const data = await gql(`
      query($after: String) {
        articles(first: 50, after: $after, sortKey: PUBLISHED_AT) {
          pageInfo { hasNextPage endCursor }
          edges {
            node {
              id handle title body tags publishedAt
              blog { handle }
              seoTitle: metafield(namespace:"global", key:"title_tag") { value }
              seoDesc:  metafield(namespace:"global", key:"description_tag") { value }
            }
          }
        }
      }
    `, { after: cursor });
    for (const { node } of data.articles.edges) articles.push(node);
    cursor = data.articles.pageInfo.hasNextPage ? data.articles.pageInfo.endCursor : null;
  } while (cursor);
  return articles;
}

// ── HTML parsing ──────────────────────────────────────────────────────────────

function stripHtml(html) {
  return (html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function stripExistingSchema(body) {
  return body.replace(/<script\s+type="application\/ld\+json">[\s\S]*?<\/script>\s*/gi, '');
}

function parseRecipeIngredients(body) {
  const root = parseHtml(body);
  for (const h of root.querySelectorAll('h2, h3')) {
    if (/ingredient|what you need/i.test(h.text)) {
      const items = [];
      let sib = h.nextElementSibling;
      while (sib && !/^H[23]$/.test(sib.tagName)) {
        sib.querySelectorAll('li').forEach(li => {
          const t = li.text.replace(/\s+/g, ' ').trim();
          if (t) items.push(t);
        });
        sib = sib.nextElementSibling;
      }
      if (items.length) return items;
    }
  }
  const ul = root.querySelector('ul');
  return ul ? ul.querySelectorAll('li').map(li => li.text.replace(/\s+/g, ' ').trim()).filter(Boolean) : [];
}

function parseRecipeInstructions(body) {
  const root = parseHtml(body);
  const keywords = /instruction|method|direction|how to|preparation|steps|to make|to prepare/i;
  for (const h of root.querySelectorAll('h2, h3')) {
    if (keywords.test(h.text)) {
      const steps = [];
      let sib = h.nextElementSibling;
      while (sib && !/^H[23]$/.test(sib.tagName)) {
        sib.querySelectorAll('li').forEach(li => {
          const t = li.text.replace(/\s+/g, ' ').trim();
          if (t) steps.push(t);
        });
        if (sib.tagName === 'P') {
          const t = sib.text.replace(/\s+/g, ' ').trim();
          if (t.length > 20) steps.push(t);
        }
        sib = sib.nextElementSibling;
      }
      if (steps.length) return steps;
    }
  }
  const ol = root.querySelector('ol');
  return ol ? ol.querySelectorAll('li').map(li => li.text.replace(/\s+/g, ' ').trim()).filter(Boolean) : [];
}

function parseFirstParagraph(body) {
  const root = parseHtml(body);
  const p = root.querySelector('p');
  return p ? p.text.replace(/\s+/g, ' ').trim().slice(0, 300) : '';
}

// ── DeepSeek helpers ──────────────────────────────────────────────────────────

async function generateRecipeMeta(title, ingredients, steps, handle) {
  const prompt = `You are an SEO expert. Return ONLY valid JSON with exactly these fields:
prepTime (ISO 8601, e.g. "PT15M"), cookTime (ISO 8601), totalTime (ISO 8601),
recipeYield (e.g. "2 servings"), recipeCategory (one of: Main Course, Breakfast, Dessert, Snack, Beverage, Soup, Salad, Side Dish),
recipeCuisine (Filipino, Italian, Japanese, Korean, Mediterranean, International — pick the best fit),
keywords (array of 5 English SEO keyword strings targeting Philippine search users).

Recipe: "${title}" | handle: ${handle}
Ingredients sample: ${ingredients.slice(0, 4).join(' | ')}
Steps count: ${steps.length}`;

  try {
    const res = await deepseek.chat.completions.create({
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0.1,
      max_tokens: 300,
    });
    return JSON.parse(res.choices[0].message.content);
  } catch {
    return {
      prepTime: 'PT15M', cookTime: 'PT25M', totalTime: 'PT40M',
      recipeYield: '2 servings', recipeCategory: 'Main Course',
      recipeCuisine: 'Filipino', keywords: [title, 'organic rice recipe Philippines'],
    };
  }
}

async function generateInfoFAQs(title, bodyText) {
  const prompt = `You are an SEO expert for Agriko, a certified organic rice farm in the Philippines.

Generate exactly 4 FAQ question-answer pairs for the article titled "${title}".
Target real search queries by Filipino consumers.
Write ALL questions and answers in ENGLISH only — no Tagalog, no Filipino.
Keep each answer to 1-3 sentences. Be factual and specific.
Return ONLY valid JSON: {"faqs":[{"q":"...","a":"..."}]}

Article excerpt: ${bodyText.slice(0, 1500)}`;

  try {
    const res = await deepseek.chat.completions.create({
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0.2,
      max_tokens: 700,
    });
    const json = JSON.parse(res.choices[0].message.content);
    return json.faqs || json.faq || [];
  } catch {
    return [];
  }
}

async function generateInfoKeywords(title, handle) {
  const prompt = `Return ONLY a JSON object {"keywords":["..."]} with 6 English SEO keywords for this Agriko (Philippine organic rice farm) article.
Title: "${title}" | Handle: "${handle}"`;
  try {
    const res = await deepseek.chat.completions.create({
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0.1,
      max_tokens: 150,
    });
    const parsed = JSON.parse(res.choices[0].message.content);
    return parsed.keywords || [title, 'Agriko Philippines'];
  } catch {
    return [title, 'Agriko', 'Philippines'];
  }
}

// ── Schema builders ───────────────────────────────────────────────────────────

function articleUrl(article) {
  const blog = article.blog?.handle || 'news';
  return `https://agrikoph.com/blogs/${blog}/${article.handle}`;
}

function buildRecipeSchema(article, ingredients, instructions, meta) {
  const url = articleUrl(article);
  return `<script type="application/ld+json">
${JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'Recipe',
  name: article.title,
  description: parseFirstParagraph(article.body).slice(0, 250),
  author: { '@type': 'Organization', name: 'Agriko', url: 'https://agrikoph.com' },
  publisher: {
    '@type': 'Organization', name: 'Agriko',
    logo: { '@type': 'ImageObject', url: 'https://agrikoph.com/cdn/shop/files/agriko-logo.png' },
  },
  datePublished: article.publishedAt?.slice(0, 10) || '2026-06-01',
  dateModified: '2026-06-26',
  mainEntityOfPage: { '@type': 'WebPage', '@id': url },
  prepTime: meta.prepTime || 'PT15M',
  cookTime: meta.cookTime || 'PT25M',
  totalTime: meta.totalTime || 'PT40M',
  recipeYield: meta.recipeYield || '2 servings',
  recipeCategory: meta.recipeCategory || 'Main Course',
  recipeCuisine: meta.recipeCuisine || 'Filipino',
  keywords: Array.isArray(meta.keywords) ? meta.keywords.join(', ') : (meta.keywords || ''),
  inLanguage: 'en-PH',
  recipeIngredient: ingredients,
  recipeInstructions: instructions.map(text => ({ '@type': 'HowToStep', text })),
  nutrition: {
    '@type': 'NutritionInformation',
    description: 'Made with Agriko certified organic whole-grain rice — high in antioxidants and fibre.',
  },
}, null, 2)}
</script>`;
}

function buildArticleSchema(article, keywords) {
  const url = articleUrl(article);
  return `<script type="application/ld+json">
${JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'Article',
  headline: article.title,
  description: (article.seoDesc?.value || parseFirstParagraph(article.body)).slice(0, 250),
  author: { '@type': 'Organization', name: 'Agriko Organic Farm', url: 'https://agrikoph.com' },
  publisher: {
    '@type': 'Organization', name: 'Agriko',
    logo: { '@type': 'ImageObject', url: 'https://agrikoph.com/cdn/shop/files/agriko-logo.png' },
  },
  datePublished: article.publishedAt?.slice(0, 10) || '2026-06-01',
  dateModified: '2026-06-26',
  mainEntityOfPage: { '@type': 'WebPage', '@id': url },
  keywords: Array.isArray(keywords) ? keywords : [keywords],
  inLanguage: 'en-PH',
}, null, 2)}
</script>`;
}

function buildFAQSchema(faqs) {
  if (!faqs?.length) return '';
  return `<script type="application/ld+json">
${JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: faqs.map(({ q, a }) => ({
    '@type': 'Question',
    name: q,
    acceptedAnswer: { '@type': 'Answer', text: a },
  })),
}, null, 2)}
</script>`;
}

function tagsForArticle(article) {
  if ((article.tags || []).length > 0) return null; // keep existing tags

  const h = article.handle;
  if (RECIPE_HANDLES.has(h)) {
    if (h.includes('black-rice') || h.startsWith('black')) {
      return ['black rice', 'organic rice', 'recipe', 'Filipino recipe', 'whole grain', 'Agriko'];
    }
    if (h.includes('red-rice') || h.startsWith('red')) {
      return ['red rice', 'organic rice', 'recipe', 'Filipino recipe', 'whole grain', 'Agriko'];
    }
    return ['organic rice', 'recipe', 'Filipino recipe', 'Agriko'];
  }

  // Informational no-tag articles
  if (h.includes('black-rice')) return ['black rice', 'organic rice', 'Philippines', 'nutrition', 'Agriko'];
  if (h.includes('red-rice'))   return ['red rice', 'organic rice', 'Philippines', 'nutrition', 'Agriko'];
  if (h.includes('lagundi') || h.includes('sambong') || h.includes('pito-pito') || h.includes('herb')) {
    return ['herbal medicine', 'Philippines', 'health', 'natural remedy', 'Agriko'];
  }
  return ['organic', 'Philippines', 'health', 'Agriko'];
}

// ── Per-article processor ─────────────────────────────────────────────────────

async function processArticle(article) {
  const h = article.handle;

  const hasSchema = article.body?.includes('application/ld+json');
  if (hasSchema && !FORCE) {
    return { handle: h, status: 'skip', reason: 'schema present (use --force to overwrite)' };
  }

  const isRecipe = RECIPE_HANDLES.has(h);
  let schemaBlock = '';

  // Strip existing schema if re-processing
  const cleanBody = hasSchema ? stripExistingSchema(article.body) : article.body;

  if (isRecipe) {
    const ingredients  = parseRecipeIngredients(cleanBody);
    const instructions = parseRecipeInstructions(cleanBody);
    const meta = await aiLimit(() => generateRecipeMeta(article.title, ingredients, instructions, h));
    // Temporarily swap body so schema builders parse clean body
    const articleForSchema = { ...article, body: cleanBody };
    schemaBlock = buildRecipeSchema(articleForSchema, ingredients, instructions, meta);
  } else {
    const bodyText = stripHtml(cleanBody);
    const [faqs, keywords] = await Promise.all([
      aiLimit(() => generateInfoFAQs(article.title, bodyText)),
      aiLimit(() => generateInfoKeywords(article.title, h)),
    ]);
    const articleForSchema = { ...article, body: cleanBody };
    schemaBlock = buildArticleSchema(articleForSchema, keywords)
      + '\n\n'
      + buildFAQSchema(faqs);
  }

  const newBody = schemaBlock + '\n\n' + cleanBody;
  const newTags = tagsForArticle(article);
  const needsMetaTitle = !article.seoTitle?.value;
  const metaTitle = needsMetaTitle ? article.title.slice(0, 55) + ' | Agriko' : null;

  if (DRY_RUN) {
    console.log(`  [DRY] ${h} | ${isRecipe ? 'recipe' : 'info'}${newTags ? ' +tags' : ''}${metaTitle ? ' +metaTitle' : ''}`);
    return { handle: h, status: 'dry-run' };
  }

  const articleInput = { body: newBody };
  if (newTags) articleInput.tags = newTags;

  const updateRes = await shopifyLimit(() => gql(`
    mutation articleUpdate($id: ID!, $article: ArticleUpdateInput!) {
      articleUpdate(id: $id, article: $article) {
        article { id }
        userErrors { field message }
      }
    }
  `, { id: article.id, article: articleInput }));

  const errs = updateRes.articleUpdate?.userErrors ?? [];
  if (errs.length) throw new Error(errs.map(e => e.message).join('; '));

  if (metaTitle) {
    await shopifyLimit(() => gql(`
      mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields { key }
          userErrors { field message }
        }
      }
    `, {
      metafields: [{
        ownerId: article.id, namespace: 'global', key: 'title_tag',
        type: 'single_line_text_field', value: metaTitle,
      }],
    }));
  }

  return {
    handle: h, status: 'done', type: isRecipe ? 'recipe' : 'info',
    tagsFix: !!newTags, metaFix: !!metaTitle, forced: hasSchema,
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

console.log(`\nAgriko SEO Schema Bulk${DRY_RUN ? ' [DRY-RUN]' : ''}${FORCE ? ' [FORCE]' : ''}`);
console.log('─'.repeat(60));

const allArticles = await fetchAllArticles();
const toProcess = allArticles.filter(a =>
  targetHandles ? targetHandles.has(a.handle) : true
);

console.log(`Processing ${toProcess.length} / ${allArticles.length} articles\n`);

let done = 0, skipped = 0, errors = 0;

const results = await Promise.all(
  toProcess.map(article =>
    processArticle(article)
      .then(r => {
        if (r.status === 'done' || r.status === 'dry-run') {
          done++;
          const flags = [
            r.type,
            r.tagsFix && '+tags',
            r.metaFix && '+metaTitle',
            r.forced  && '(re-processed)',
          ].filter(Boolean).join(' ');
          console.log(`  ✓ ${r.handle} [${flags}]`);
        } else {
          skipped++;
          console.log(`  ─ ${r.handle} (${r.reason})`);
        }
        return r;
      })
      .catch(err => {
        errors++;
        console.error(`  ✗ ${article.handle}: ${err.message}`);
        return { handle: article.handle, status: 'error', error: err.message };
      })
  )
);

console.log('\n' + '─'.repeat(60));
console.log(`Done: ${done}  Skipped: ${skipped}  Errors: ${errors}`);
if (errors > 0) {
  console.log('\nErrors:');
  results.filter(r => r.status === 'error').forEach(r => console.log(`  ${r.handle}: ${r.error}`));
}
