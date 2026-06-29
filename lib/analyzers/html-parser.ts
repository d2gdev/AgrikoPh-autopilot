import { parse } from "node-html-parser";

export interface ParsedArticleHtml {
  h1s: string[];
  h2s: string[];
  h3s: string[];
  anchors: Array<{ href: string; text: string }>;
  images: string[];
  textContent: string;
  wordCount: number;
}

export function parseArticleHtml(bodyHtml: string): ParsedArticleHtml {
  if (!bodyHtml.trim()) {
    return { h1s: [], h2s: [], h3s: [], anchors: [], images: [], textContent: "", wordCount: 0 };
  }
  const root = parse(bodyHtml);
  const textContent = root.text.trim();
  return {
    h1s: root.querySelectorAll("h1").map((el) => el.text.trim()),
    h2s: root.querySelectorAll("h2").map((el) => el.text.trim()),
    h3s: root.querySelectorAll("h3").map((el) => el.text.trim()),
    anchors: root.querySelectorAll("a").map((el) => ({
      href: el.getAttribute("href") ?? "",
      text: el.text.trim(),
    })),
    images: root.querySelectorAll("img").map((el) => el.getAttribute("src") ?? ""),
    textContent,
    wordCount: textContent ? textContent.split(/\s+/).filter(Boolean).length : 0,
  };
}
