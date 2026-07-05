import { Text, BlockStack, List } from "@shopify/polaris";

// ── AI brief renderer (ported from the retired /seo page) ──

export function InlineBold({ text }: { text: string }) {
  const parts = text.split(/\*\*(.+?)\*\*/g);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? <strong key={i}>{part}</strong> : <span key={i}>{part}</span>
      )}
    </>
  );
}

export function BriefRenderer({ text }: { text: string }) {
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];
  const pendingBullets: string[] = [];

  function flushBullets() {
    if (pendingBullets.length === 0) return;
    elements.push(
      <List key={`b-${elements.length}`} type="bullet">
        {pendingBullets.map((b, i) => (
          <List.Item key={i}><InlineBold text={b} /></List.Item>
        ))}
      </List>,
    );
    pendingBullets.length = 0;
  }

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { flushBullets(); continue; }

    const bullet = line.match(/^[-•*]\s+(.+)/) ?? line.match(/^\d+\.\s+(.+)/);
    if (bullet) { pendingBullets.push(bullet[1]!); continue; }

    flushBullets();
    const heading = line.match(/^#{1,3}\s+(.+)/);
    if (heading) {
      elements.push(
        <Text key={elements.length} variant="headingSm" as="h3">{heading[1]}</Text>,
      );
    } else {
      elements.push(
        <Text key={elements.length} as="p"><InlineBold text={line} /></Text>,
      );
    }
  }
  flushBullets();

  return <BlockStack gap="200">{elements}</BlockStack>;
}
