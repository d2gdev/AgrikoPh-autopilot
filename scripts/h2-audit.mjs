import { chromium } from 'playwright';

const URL = 'https://agrikoph.com/blogs/news/red-rice-vs-black-rice-which-organic-grain-is-healthier-for-filipinos';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });

const h2Data = await page.evaluate(() => {
  const h2s = Array.from(document.querySelectorAll('h2'));
  return h2s.map(el => {
    const cs = window.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    // Walk up to find first ancestor with non-transparent background
    let bgEl = el;
    let bg = 'rgba(0, 0, 0, 0)';
    while (bgEl && bg === 'rgba(0, 0, 0, 0)') {
      bg = window.getComputedStyle(bgEl).backgroundColor;
      bgEl = bgEl.parentElement;
    }
    return {
      text: el.textContent.trim().slice(0, 60),
      color: cs.color,
      effectiveBg: bg,
      visibility: cs.visibility,
      display: cs.display,
      opacity: cs.opacity,
      inlineStyle: el.getAttribute('style') || '',
      inDom: rect.width > 0 && rect.height > 0,
      top: Math.round(rect.top + window.scrollY),
      parentClass: el.parentElement?.className?.slice(0, 80) || '',
    };
  });
});

console.log('=== H2 AUDIT ===');
if (h2Data.length === 0) {
  console.log('NO H2s found on page at all');
} else {
  h2Data.forEach((h, i) => {
    console.log(`\n[${i}] "${h.text}"`);
    console.log(`  color: ${h.color}  |  effectiveBg: ${h.effectiveBg}`);
    console.log(`  visibility: ${h.visibility}  display: ${h.display}  opacity: ${h.opacity}`);
    console.log(`  inDom: ${h.inDom}  top: ${h.top}px`);
    console.log(`  inline: ${h.inlineStyle || '(none)'}`);
    console.log(`  parent: ${h.parentClass}`);
  });
}

const SCRATCHPAD = '/tmp/claude-0/-mnt-c-Users-Sean-Documents-Agriko-autopilot-app/1a5e697a-0b0e-42d5-8ff6-4d517e168168/scratchpad';
await page.screenshot({ path: `${SCRATCHPAD}/h2-audit.png`, fullPage: false, clip: { x: 0, y: 0, width: 1280, height: 1400 } });
console.log('\nScreenshot saved to scratchpad.');

await browser.close();
