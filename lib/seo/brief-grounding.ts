import { retrieveContext, formatGroundingBlock } from "@/lib/ai/knowledge";

// Grounds the SEO brief's prompt context in the KB corpus. Additive — unchanged when empty.
export async function groundSeoBriefContext(baseContext: string, query: string): Promise<string> {
  const chunks = await retrieveContext({
    query,
    sourceTypes: ["article", "recommendation"],
    topK: 6,
  });
  const block = formatGroundingBlock(chunks);
  return block ? `${baseContext}\n\n${block}` : baseContext;
}
