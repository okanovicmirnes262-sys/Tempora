import type { Metadata, Viewport } from "next";
import { APP } from "@/lib/config";
import { ToastProvider } from "@/components/ui";
import "./globals.css";

export const metadata: Metadata = {
  title: APP.name,
  description: APP.description,
  applicationName: APP.name,
  manifest: "/app.webmanifest",
  appleWebApp: { capable: true, title: APP.shortName, statusBarStyle: "black-translucent" },
  icons: {
    icon: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: APP.themeColor,
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang={APP.lang}>
      <body>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
