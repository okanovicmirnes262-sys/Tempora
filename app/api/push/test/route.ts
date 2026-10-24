import { NextResponse } from "next/server";
import { supabaseAdmin, supabaseServer } from "@/lib/supabase/server";
import { pushToOwners } from "@/lib/push-server";
import { APP } from "@/lib/config";

// Probna obavijest vlasniku (Postavke → Obavijesti).
export async function POST(req: Request) {
  const { orgId } = await req.json().catch(() => ({}));
  const supabase = await supabaseServer();
  const { data: ok } = await supabase.rpc("is_org_member", { p_org: orgId });
  if (!ok) return NextResponse.json({ error: "Zabranjeno" }, { status: 403 });
  if (!process.env.VAPID_PRIVATE_KEY) return NextResponse.json({ error: "VAPID ključevi nisu postavljeni na Vercelu" }, { status: 500 });
  const sent = await pushToOwners(supabaseAdmin(), orgId, {
    title: APP.name, body: "Obavijesti rade ✓", url: "/raspored", tag: "test",
  });
  return NextResponse.json({ sent });
}
