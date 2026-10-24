import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/owner/session";
import { OwnerShell } from "@/components/owner/OwnerShell";

export default async function OwnerLayout({ children }: { children: React.ReactNode }) {
  const { org } = await requireOwner();
  if (!org) redirect("/postavljanje");
  return <OwnerShell org={org}>{children}</OwnerShell>;
}
