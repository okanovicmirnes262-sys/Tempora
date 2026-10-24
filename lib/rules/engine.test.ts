import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { addDays, dateRange, dayIndex } from "../dates";
import { computeWarnings, FREE_CELL, suggestReplacements, worstSeverity, groupByCell, cellKey } from "./engine";
import { easterSunday, holidaysForYear } from "./holidays";
import { monthlyHours, splitShift, workedMinutes } from "./hours";
import hr from "./hr.json";
import type { Assignment, LaborRules, ScheduleData, Warning } from "./types";

const rules = hr as LaborRules;

// Isti podaci kao u supabase/seed.sql
const BARONE = { id: "barone", name: "Barone", closed_weekdays: [] as number[] };
const ARSEN = { id: "arsen", name: "Arsen", closed_weekdays: [] as number[] };
const DNEVNA = { id: "b-dnevna", location_id: "barone", name: "Dnevna", start_time: "09:00", end_time: "17:00" };
const JUTRO = { id: "a-jutro", location_id: "arsen", name: "Jutro", start_time: "09:00", end_time: "15:00" };
const POPODNE = { id: "a-popodne", location_id: "arsen", name: "Popodne", start_time: "15:00", end_time: "21:00" };
const NAMES = ["Kristina", "Luca", "Filip", "Bruno", "Franko", "Mirnes"];
const employees = NAMES.map((n) => ({ id: n.toLowerCase(), name: n, weekly_hours: 40 }));

function data(assignments: Assignment[], extra: Partial<ScheduleData> = {}): ScheduleData {
  return {
    rules,
    employees,
    locations: [BARONE, ARSEN],
    templates: [DNEVNA, JUTRO, POPODNE],
    assignments,
    absences: [],
    availability: [],
    closures: [],
    ...extra,
  };
}

const a = (date: string, tpl: { id: string }, emp: string): Assignment => ({ date, shift_template_id: tpl.id, employee_id: emp });
const of = (ws: Warning[], kind: Warning["kind"], emp?: string) =>
  ws.filter((w) => w.kind === kind && (!emp || w.employee_id === emp));

describe("tjedni odmor", () => {
  it("Filip radi svaki dan od 14. do 21. listopada => crveno upozorenje", () => {
    const asg = dateRange("2026-10-14", "2026-10-21").map((d) => a(d, DNEVNA, "filip"));
    const ws = computeWarnings(data(asg), "2026-10-12", "2026-10-25");
    const weekly = of(ws, "weekly_rest", "filip");
    expect(weekly.length).toBeGreaterThan(0);
    expect(weekly.every((w) => w.severity === "red")).toBe(true);
    expect(weekly.map((w) => w.date)).toEqual(["2026-10-20", "2026-10-21"]);
    expect(weekly[0].message).toContain("7. dan zaredom");
    expect(worstSeverity(groupByCell(ws).get(cellKey("2026-10-21", DNEVNA.id)))).toBe("red");
  });

  it("6 dana zaredom pa slobodan dan je u redu", () => {
    const asg = dateRange("2026-10-12", "2026-10-17").map((d) => a(d, DNEVNA, "filip"));
    asg.push(...dateRange("2026-10-19", "2026-10-24").map((d) => a(d, DNEVNA, "filip")));
    const ws = computeWarnings(data(asg), "2026-10-12", "2026-10-25");
    expect(of(ws, "weekly_rest")).toEqual([]);
  });

  it("slobodan dan kraći od 36 h ne prekida razdoblje (crveno bez 7 dana zaredom)", () => {
    const RANO = { id: "a-rano", location_id: "arsen", name: "Rano", start_time: "07:00", end_time: "13:00" };
    // pon–sub popodne (do 21:00), nedjelja slobodna, ponedjeljak od 07:00 => samo 34 h odmora
    const asg = dateRange("2026-10-12", "2026-10-17").map((d) => a(d, POPODNE, "luca"));
    asg.push(a("2026-10-19", RANO, "luca"), a("2026-10-20", RANO, "luca"));
    const d = data(asg, { templates: [DNEVNA, JUTRO, POPODNE, RANO] });
    const ws = of(computeWarnings(d, "2026-10-12", "2026-10-25"), "weekly_rest", "luca");
    expect(ws.map((w) => w.date)).toEqual(["2026-10-19", "2026-10-20"]);
    expect(ws[0].message).toContain("36 h neprekidnog odmora");
  });
});

describe("dnevni odmor", () => {
  it("Arsen popodne pa sutra Arsen jutro => žuto (točno 12 h)", () => {
    const ws = computeWarnings(data([a("2026-10-22", POPODNE, "luca"), a("2026-10-23", JUTRO, "luca")]), "2026-10-19", "2026-10-25");
    const daily = of(ws, "daily_rest", "luca");
    expect(daily).toHaveLength(1);
    expect(daily[0]).toMatchObject({ severity: "yellow", date: "2026-10-23", cell: JUTRO.id });
    expect(daily[0].message).toContain("na rubu");
  });

  it("manje od 12 h => crveno", () => {
    const RANO = { id: "a-rano", location_id: "arsen", name: "Rano", start_time: "08:00", end_time: "14:00" };
    const d = data([a("2026-10-22", POPODNE, "luca"), a("2026-10-23", RANO, "luca")], { templates: [DNEVNA, JUTRO, POPODNE, RANO] });
    const daily = of(computeWarnings(d, "2026-10-19", "2026-10-25"), "daily_rest", "luca");
    expect(daily).toHaveLength(1);
    expect(daily[0].severity).toBe("red");
    expect(daily[0].message).toContain("samo 11 h");
  });

  it("jutro + popodne isti dan nije kršenje dnevnog odmora", () => {
    const ws = computeWarnings(data([a("2026-10-22", JUTRO, "luca"), a("2026-10-22", POPODNE, "luca")]), "2026-10-19", "2026-10-25");
    expect(of(ws, "daily_rest")).toEqual([]);
    expect(of(ws, "double_booking")).toEqual([]);
  });
});

describe("ostala upozorenja", () => {
  it("smjena od 6+ sati uključuje stanku od 30 min (informacija)", () => {
    const KRATKA = { id: "kratka", location_id: "arsen", name: "Kratka", start_time: "17:00", end_time: "21:00" };
    const d = data([a("2026-10-22", JUTRO, "luca"), a("2026-10-22", KRATKA, "bruno")], { templates: [JUTRO, KRATKA] });
    const br = of(computeWarnings(d, "2026-10-22", "2026-10-22"), "break");
    expect(br).toHaveLength(1);
    expect(br[0]).toMatchObject({ severity: "info", cell: JUTRO.id });
    expect(br[0].message).toContain("30 min stanke");
  });

  it("prekovremeni iznad 180 h godišnje", () => {
    const DUGA = { id: "duga", location_id: "barone", name: "Duga", start_time: "08:00", end_time: "20:00" };
    // 5 x 12 h = 60 h tjedno => 20 h prekovremenih tjedno; nakon 9 tjedana 180 h (još u redu), 10. tjedan 200 h
    const asg: Assignment[] = [];
    for (let w = 0; w < 10; w++) {
      const monday = addDays("2026-01-05", w * 7);
      for (let d = 0; d < 5; d++) asg.push(a(addDays(monday, d), DUGA, "bruno"));
    }
    const d = data(asg, { templates: [DUGA] });
    const week9 = of(computeWarnings(d, "2026-03-02", "2026-03-08"), "overtime_year");
    const week10 = of(computeWarnings(d, "2026-03-09", "2026-03-15"), "overtime_year");
    expect(week9).toEqual([]);
    expect(week10).toHaveLength(5);
    expect(week10[0].severity).toBe("red");
    expect(week10[0].message).toContain("200 h");
  });

  it("isti radnik na dva lokala u isto vrijeme", () => {
    const ws = of(computeWarnings(data([a("2026-10-22", DNEVNA, "filip"), a("2026-10-22", JUTRO, "filip")]), "2026-10-22", "2026-10-22"), "double_booking");
    expect(ws.map((w) => w.cell).sort()).toEqual([JUTRO.id, DNEVNA.id].sort());
    expect(ws.every((w) => w.severity === "red")).toBe(true);
  });

  it("nepokrivena smjena, osim kad je lokal zatvoren", () => {
    const asg = [a("2026-10-22", DNEVNA, "kristina")];
    const open = of(computeWarnings(data(asg), "2026-10-22", "2026-10-22"), "uncovered");
    expect(open.map((w) => w.cell).sort()).toEqual([JUTRO.id, POPODNE.id].sort());

    const closed = of(computeWarnings(data(asg, { closures: [{ location_id: "arsen", date: "2026-10-22" }] }), "2026-10-22", "2026-10-22"), "uncovered");
    expect(closed).toEqual([]);

    const weekly = of(computeWarnings(data(asg, { locations: [BARONE, { ...ARSEN, closed_weekdays: [4] }] }), "2026-10-22", "2026-10-22"), "uncovered");
    expect(weekly).toEqual([]);
  });

  it("neoznačeni radnik (ni raspoređen ni slobodan)", () => {
    const asg = [a("2026-10-22", DNEVNA, "kristina"), a("2026-10-22", JUTRO, "luca"), a("2026-10-22", POPODNE, "filip")];
    const d = data(asg, {
      absences: [
        { employee_id: "bruno", date_from: "2026-10-22", date_to: "2026-10-22", type: "slobodan" },
        { employee_id: "mirnes", date_from: "2026-10-20", date_to: "2026-10-30", type: "godisnji" },
      ],
    });
    const ws = of(computeWarnings(d, "2026-10-22", "2026-10-22"), "unmarked");
    expect(ws.map((w) => w.employee_id)).toEqual(["franko"]);
    expect(ws[0]).toMatchObject({ cell: FREE_CELL, severity: "yellow" });
  });

  it("raspoređen kad je upisao da ne može", () => {
    const d = data([a("2026-10-24", POPODNE, "bruno"), a("2026-10-22", JUTRO, "luca")], {
      availability: [
        { employee_id: "bruno", date: null, weekday: 6, note: "Subotom ne mogu" },
        { employee_id: "luca", date: "2026-10-22", weekday: null },
      ],
    });
    const ws = of(computeWarnings(d, "2026-10-19", "2026-10-25"), "unavailable");
    expect(ws).toHaveLength(2);
    expect(ws.find((w) => w.employee_id === "bruno")?.message).toContain("subotom");
    expect(ws.every((w) => w.severity === "red")).toBe(true);
  });

  it("raspoređen na godišnjem", () => {
    const d = data([a("2026-10-27", JUTRO, "mirnes")], {
      absences: [{ employee_id: "mirnes", date_from: "2026-10-26", date_to: "2026-10-30", type: "godisnji" }],
    });
    expect(of(computeWarnings(d, "2026-10-26", "2026-11-01"), "absent")).toHaveLength(1);
  });
});

describe("prijedlog zamjene", () => {
  it("predlaže slobodne radnike koji ne krše odmor", () => {
    const asg = [
      a("2026-10-22", DNEVNA, "kristina"),
      a("2026-10-22", JUTRO, "franko"),
      a("2026-10-21", POPODNE, "bruno"),           // Bruno: 12 h prije jutra je na rubu, ali u redu
      a("2026-10-22", POPODNE, "filip"),
    ];
    const d = data(asg, {
      absences: [{ employee_id: "mirnes", date_from: "2026-10-22", date_to: "2026-10-22", type: "bolovanje" }],
      availability: [{ employee_id: "luca", date: "2026-10-23", weekday: null }],
    });
    const s = suggestReplacements(d, "2026-10-23", JUTRO.id).map((x) => x.employee.name);
    expect(s).toContain("Kristina");
    expect(s).toContain("Bruno");
    expect(s).not.toContain("Luca");   // ne može taj dan
    expect(s).toContain("Filip");      // popodne 22. do 21:00, jutro 23. u 09:00 = 12 h, dopušteno
    expect(s).toContain("Mirnes");     // bolovanje je 22., ne 23.

    const RANO = { id: "a-rano", location_id: "arsen", name: "Rano", start_time: "07:00", end_time: "13:00" };
    const d2 = data(asg, { templates: [DNEVNA, JUTRO, POPODNE, RANO] });
    expect(suggestReplacements(d2, "2026-10-23", RANO.id).map((x) => x.employee.name)).not.toContain("Filip");
  });
});

describe("blagdani", () => {
  it("računa Uskrs i blagdane vezane uz Uskrs", () => {
    expect(easterSunday(2025)).toBe("2025-04-20");
    expect(easterSunday(2026)).toBe("2026-04-05");
    expect(easterSunday(2027)).toBe("2027-03-28");
    const h = holidaysForYear(rules, 2026);
    expect(h.get("2026-04-06")).toBe("Uskrsni ponedjeljak");
    expect(h.get("2026-06-04")).toBe("Tijelovo");
    expect(h.get("2026-11-18")).toBe("Dan sjećanja na žrtve Domovinskog rata");
    expect(h.size).toBe(14);
  });
});

describe("sati za izvoz", () => {
  const holidays = holidaysForYear(rules, 2026);

  it("noćni sati 22–06, preko ponoći", () => {
    const s = splitShift("2026-10-23", { start_time: "20:00", end_time: "04:00" }, rules, holidays);
    expect(s.total).toBe(8 * 60);
    expect(s.night).toBe(6 * 60);
    expect(s.sunday).toBe(0);
  });

  it("nedjeljni i blagdanski sati", () => {
    const sun = splitShift("2026-10-25", { start_time: "15:00", end_time: "21:00" }, rules, holidays);
    expect(sun.sunday).toBe(6 * 60);
    const hol = splitShift("2026-11-01", { start_time: "09:00", end_time: "17:00" }, rules, holidays);
    expect(hol.holiday).toBe(8 * 60);
    expect(hol.sunday).toBe(8 * 60); // Svi sveti 2026. su u nedjelju
  });

  it("prekovremeni iznad ugovorenih tjednih sati", () => {
    // 6 x 8 h = 48 h, ugovor 40 h => 8 h prekovremenih
    const asg = dateRange("2026-10-12", "2026-10-17").map((d) => a(d, DNEVNA, "kristina"));
    const h = monthlyHours("2026-10-01", "2026-10-31", employees, [DNEVNA], asg, rules).get("kristina")!;
    expect(h.total).toBe(48 * 60);
    expect(h.overtime).toBe(8 * 60);
    expect(h.regular).toBe(40 * 60);
    expect(h.shifts).toBe(6);
  });

  it("tjedan na prijelazu mjeseca: prekovremeni pripadaju zadnjim satima tjedna", () => {
    // pon 28.9.–sub 3.10.: 6 x 8 h; prekovremenih 8 h pada na subotu 3.10. (listopad)
    const asg = dateRange("2026-09-28", "2026-10-03").map((d) => a(d, DNEVNA, "kristina"));
    const oct = monthlyHours("2026-10-01", "2026-10-31", employees, [DNEVNA], asg, rules).get("kristina")!;
    const sep = monthlyHours("2026-09-01", "2026-09-30", employees, [DNEVNA], asg, rules).get("kristina")!;
    expect(oct.overtime).toBe(8 * 60);
    expect(sep.overtime).toBe(0);
  });

  it("odrađeni sati do sada", () => {
    const shifts = [
      { date: "2026-10-22", start: "09:00", end: "17:00" },
      { date: "2026-10-24", start: "09:00", end: "17:00" },
    ];
    const now = dayIndex("2026-10-24") * 1440 + 13 * 60;
    expect(workedMinutes(shifts, "2026-10-01", "2026-10-31", now)).toBe(12 * 60);
  });
});

describe("pravila kao podaci", () => {
  it("lib/rules/hr.json je jednak JSON-u u migraciji", () => {
    const sql = readFileSync(path.join(__dirname, "../../supabase/migrations/20261024000100_labor_rules_hr.sql"), "utf8");
    const json = sql.match(/\$json\$([\s\S]*)\$json\$/)![1];
    expect(JSON.parse(json)).toEqual(hr);
  });
});
