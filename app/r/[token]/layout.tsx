import type { Metadata } from "next";
import { APP } from "@/lib/config";

// Svaki radnik ima svoj manifest, pa aplikacija s početnog zaslona otvara baš njegov link.
export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  return {
    title: APP.name,
    manifest: `/r/${encodeURIComponent(token)}/manifest`,
    robots: { index: false, follow: false },
    referrer: "no-referrer",
  };
}

export default function WorkerLayout({ children }: { children: React.ReactNode }) {
  return children;
}
