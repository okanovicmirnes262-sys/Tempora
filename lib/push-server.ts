import "server-only";
import webpush from "web-push";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface PushPayload {
  title: string;
  body: string;
  url: string;
  tag?: string;
}

let configured = false;
function configure() {
  if (configured) return true;
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return false;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:admin@example.com", pub, priv);
  configured = true;
  return true;
}

interface SubRow { id: string; endpoint: string; p256dh: string; auth: string; employee_id: string | null; user_id: string | null }

async function sendAll(admin: SupabaseClient, subs: SubRow[], payload: (s: SubRow) => PushPayload | null) {
  if (!configure() || !subs.length) return 0;
  let sent = 0;
  const dead: string[] = [];
  await Promise.all(subs.map(async (s) => {
    const p = payload(s);
    if (!p) return;
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(p), { TTL: 60 * 60 * 24 });
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) dead.push(s.id);
    }
  }));
  if (dead.length) await admin.from("push_subscriptions").delete().in("id", dead);
  return sent;
}

/** Šalje obavijest radnicima; poveznica vodi na njihov osobni link. */
export async function pushToEmployees(
  admin: SupabaseClient,
  employeeIds: string[],
  make: (emp: { id: string; name: string; token: string }) => Omit<PushPayload, "url"> & { path?: string },
) {
  if (!employeeIds.length) return 0;
  const [{ data: emps }, { data: subs }] = await Promise.all([
    admin.from("employees").select("id, name, token").in("id", employeeIds),
    admin.from("push_subscriptions").select("*").in("employee_id", employeeIds),
  ]);
  const byId = new Map((emps ?? []).map((e) => [e.id, e]));
  return sendAll(admin, (subs ?? []) as SubRow[], (s) => {
    const e = byId.get(s.employee_id!);
    if (!e) return null;
    const p = make(e);
    return { title: p.title, body: p.body, tag: p.tag, url: `/r/${e.token}${p.path ?? ""}` };
  });
}

export async function pushToOwners(admin: SupabaseClient, orgId: string, payload: PushPayload) {
  const { data: subs } = await admin.from("push_subscriptions").select("*").eq("org_id", orgId).not("user_id", "is", null);
  return sendAll(admin, (subs ?? []) as SubRow[], () => payload);
}
