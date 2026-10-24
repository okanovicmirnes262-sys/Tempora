import "server-only";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";

export interface OrgInfo {
  id: string;
  name: string;
  country: string;
  email: string;
}

/** Vlasnik mora biti prijavljen; vraća njegovu organizaciju ili null ako je još nema. */
export async function requireOwner(): Promise<{ org: OrgInfo | null; email: string }> {
  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/prijava");
  await supabase.rpc("claim_invited_orgs");
  const { data: orgs } = await supabase
    .from("organizations")
    .select("id, name, country, created_at")
    .order("created_at", { ascending: true })
    .limit(1);
  const email = auth.user.email ?? "";
  const o = orgs?.[0];
  return { org: o ? { id: o.id, name: o.name, country: o.country, email } : null, email };
}
