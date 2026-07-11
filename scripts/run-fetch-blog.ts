import { runFetchBlogContentLocked } from "../jobs/fetch-blog-content";

async function main() {
  console.log("[run] Starting fetch-blog-content...");
  const locked = await runFetchBlogContentLocked();
  if (!locked.acquired) throw new Error("fetch-blog-content is already running");
  const result = locked.result;
  console.log("[run] Done:", result);
  if (result.errors.length > 0) {
    console.error("[run] Errors:", result.errors);
  }
  process.exit(result.status === "failed" ? 1 : 0);
}

main();
