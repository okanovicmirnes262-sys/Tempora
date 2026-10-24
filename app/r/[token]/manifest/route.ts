import { manifest, manifestResponse } from "@/lib/manifest";

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const path = `/r/${encodeURIComponent(token)}`;
  return manifestResponse(manifest(path, path));
}
