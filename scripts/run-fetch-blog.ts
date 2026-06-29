import { fetchBlogContentHandler } from "../jobs/fetch-blog-content";

async function main() {
  console.log("[run] Starting fetch-blog-content...");
  const result = await fetchBlogContentHandler();
  console.log("[run] Done:", result);
  if (result.errors.length > 0) {
    console.error("[run] Errors:", result.errors);
  }
  process.exit(result.status === "failed" ? 1 : 0);
}

main();
