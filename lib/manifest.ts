import { APP } from "./config";

export function manifest(startUrl: string, scope: string, name: string = APP.name) {
  return {
    name,
    short_name: APP.shortName,
    description: APP.description,
    lang: APP.lang,
    start_url: startUrl,
    scope,
    display: "standalone",
    orientation: "portrait",
    background_color: APP.backgroundColor,
    theme_color: APP.themeColor,
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

export function manifestResponse(body: object) {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/manifest+json", "cache-control": "no-cache" },
  });
}
