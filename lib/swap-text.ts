import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fmtShort, hhmm } from "./dates";

/** 'Arsen Popodne, čet 29.10. 15:00–21:00' */
export async function swapDescription(admin: SupabaseClient, swapId: string) {
  const { data } = await admin
    .from("swap_requests")
    .select("date, shift_templates(name, start_time, end_time, locations(name))")
    .eq("id", swapId)
    .single();
  const t = data?.shift_templates as unknown as { name: string; start_time: string; end_time: string; locations: { name: string } } | undefined;
  if (!data || !t) return "smjenu";
  return `${t.locations.name} ${t.name}, ${fmtShort(data.date)} ${hhmm(t.start_time)}–${hhmm(t.end_time)}`;
}
