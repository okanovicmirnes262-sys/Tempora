import { NextResponse } from "next/server";
import { supabaseAdmin, supabaseServer } from "@/lib/supabase/server";
import { pushToEmployees } from "@/lib/push-server";
import { swapDescription } from "@/lib/swap-text";

// Vlasnik odobrava ili odbija zamjenu; svi uključeni dobivaju push.
export async function POST(req: Request) {
  const { id, approve } = await req.json().catch(() => ({}));
  if (typeof id !== "string" || typeof approve !== "boolean") {
    return NextResponse.json({ error: "Neispravan zahtjev" }, { status: 400 });
  }
  const supabase = await supabaseServer();
  const { data: swap, error } = await supabase.rpc("decide_swap", { p_swap: id, p_approve: approve });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  try {
    const admin = supabaseAdmin();
    const desc = await swapDescription(admin, swap.id);
    const ids = [swap.from_employee_id, swap.accepted_by].filter(Boolean) as string[];
    await pushToEmployees(admin, ids, (e) => ({
      title: approve ? "Zamjena odobrena" : "Zamjena odbijena",
      body: approve
        ? e.id === swap.accepted_by ? `Preuzimaš smjenu ${desc}.` : `${desc} više nije tvoja smjena.`
        : `Zamjena za ${desc} nije odobrena.`,
      tag: `swap-${swap.id}`,
    }));
  } catch {
    // push nije kritičan
  }
  return NextResponse.json({ ok: true, status: swap.status });
}
