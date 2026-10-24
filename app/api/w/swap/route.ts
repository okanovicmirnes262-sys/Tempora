import { NextResponse } from "next/server";
import { supabaseAdmin, supabaseAnon } from "@/lib/supabase/server";
import { pushToEmployees, pushToOwners } from "@/lib/push-server";
import { swapDescription } from "@/lib/swap-text";

// Radničke radnje oko zamjena (token je jedina vjerodajnica) + push obavijesti.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { token, action } = body as { token?: string; action?: string };
  if (typeof token !== "string" || token.length < 32) return NextResponse.json({ error: "Neispravan link" }, { status: 401 });
  const anon = supabaseAnon();

  if (action === "offer") {
    const { date, shiftTemplateId, toEmployeeId } = body;
    const { data: swapId, error } = await anon.rpc("w_offer_swap", {
      p_token: token, p_date: date, p_shift_template: shiftTemplateId, p_to_employee: toEmployeeId ?? null,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    await notify(async (admin) => {
      const { data: s } = await admin.from("swap_requests").select("org_id, from_employee_id, to_employee_id").eq("id", swapId).single();
      if (!s) return;
      const [{ data: from }, desc] = await Promise.all([
        admin.from("employees").select("name").eq("id", s.from_employee_id).single(),
        swapDescription(admin, swapId),
      ]);
      let targets: string[] = s.to_employee_id ? [s.to_employee_id] : [];
      if (!targets.length) {
        const { data: all } = await admin.from("employees").select("id").eq("org_id", s.org_id).eq("active", true).neq("id", s.from_employee_id);
        targets = (all ?? []).map((e) => e.id);
      }
      await pushToEmployees(admin, targets, () => ({
        title: "Ponuda za zamjenu",
        body: `${from?.name ?? "Kolega"} nudi smjenu ${desc}. Tapni za prihvaćanje.`,
        tag: `swap-${swapId}`,
        path: "?tab=zamjene",
      }));
    });
    return NextResponse.json({ ok: true, id: swapId });
  }

  if (action === "accept") {
    const { id } = body;
    const { data: orgId, error } = await anon.rpc("w_accept_swap", { p_token: token, p_id: id });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    await notify(async (admin) => {
      const { data: s } = await admin.from("swap_requests").select("from_employee_id, accepted_by").eq("id", id).single();
      if (!s) return;
      const [{ data: people }, desc] = await Promise.all([
        admin.from("employees").select("id, name").in("id", [s.from_employee_id, s.accepted_by]),
        swapDescription(admin, id),
      ]);
      const nameOf = (eid: string) => people?.find((p) => p.id === eid)?.name ?? "Kolega";
      const fromName = nameOf(s.from_employee_id);
      const accName = nameOf(s.accepted_by);
      await pushToOwners(admin, orgId, {
        title: "Zamjena čeka odobrenje",
        body: `${accName} preuzima smjenu od: ${fromName} — ${desc}. Odobri jednim tapom.`,
        url: "/zamjene",
        tag: `swap-${id}`,
      });
      await pushToEmployees(admin, [s.from_employee_id], () => ({
        title: "Zamjena prihvaćena",
        body: `${accName} preuzima tvoju smjenu (${desc}). Čeka se odobrenje.`,
        tag: `swap-${id}`,
      }));
    });
    return NextResponse.json({ ok: true });
  }

  if (action === "cancel") {
    const { error } = await anon.rpc("w_cancel_swap", { p_token: token, p_id: body.id });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Nepoznata radnja" }, { status: 400 });
}

async function notify(fn: (admin: ReturnType<typeof supabaseAdmin>) => Promise<void>) {
  try {
    await fn(supabaseAdmin());
  } catch {
    // obavijesti nisu kritične
  }
}
