import { manifest, manifestResponse } from "@/lib/manifest";

// Manifest za vlasnika: aplikacija s početnog zaslona otvara raspored.
export function GET() {
  return manifestResponse(manifest("/raspored", "/"));
}
