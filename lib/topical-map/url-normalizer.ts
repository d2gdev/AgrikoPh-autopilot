import { GovernedUrlError } from "./types";

const governedHost = "agrikoph.com";

export function normalizeGovernedUrl(value: string): string {
  if (value.startsWith("//") || /^\/\\+/.test(value)) throw new GovernedUrlError("EXTERNAL_GOVERNED_URL");
  if (value.startsWith("/")) {
    try {
      const url = new URL(value, `https://${governedHost}`);
      return `${url.pathname}${url.search}${url.hash}`;
    } catch {
      throw new GovernedUrlError("INVALID_GOVERNED_URL");
    }
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new GovernedUrlError("INVALID_GOVERNED_URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new GovernedUrlError("INVALID_GOVERNED_URL");
  if (url.hostname.toLowerCase() !== governedHost) throw new GovernedUrlError("EXTERNAL_GOVERNED_URL");
  if ((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80")) url.port = "";
  url.hostname = governedHost;
  return url.toString();
}
