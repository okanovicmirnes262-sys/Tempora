import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/owner/session";
import { SetupWizard } from "@/components/owner/SetupWizard";

export default async function PostavljanjePage() {
  const { org } = await requireOwner();
  if (org) redirect("/raspored");
  return <SetupWizard />;
}
