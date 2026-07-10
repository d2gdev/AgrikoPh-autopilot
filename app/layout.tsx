export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const apiKey = process.env.NEXT_PUBLIC_SHOPIFY_SESSION_API_KEY ?? process.env.NEXT_PUBLIC_SHOPIFY_API_KEY ?? "";
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta name="shopify-api-key" content={apiKey} />
        <script
          dangerouslySetInnerHTML={{
            __html: "window.__agrikoNativeFetch = window.fetch.bind(window);",
          }}
        />
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script src="https://cdn.shopify.com/shopifycloud/app-bridge.js" />
        <script
          dangerouslySetInnerHTML={{
            __html: `
(function () {
  var nativeFetch = window.__agrikoNativeFetch;
  if (!nativeFetch) return;
  var appBridgeFetch = window.fetch.bind(window);
  window.__agrikoAppBridgeFetch = appBridgeFetch;
  window.fetch = function (input, init) {
    try {
      var requestUrl = input instanceof Request ? input.url : String(input);
      var url = new URL(requestUrl, window.location.href);
      if (url.origin === window.location.origin) {
        return nativeFetch(input, init);
      }
    } catch (_) {}
    return appBridgeFetch(input, init);
  };
})();`,
          }}
        />
      </head>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
