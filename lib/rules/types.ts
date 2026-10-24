import type { DateStr } from "../dates";

/** Pravila rada kakva su spremljena u labor_rules.rules (JSON). */
export interface LaborRules {
  daily_rest_hours: number;
  weekly_rest_hours: number;
  rest_period_days: number;
  max_consecutive_days: number;
  break: { min_shift_hours: number; minutes: number; counts_as_work: boolean };
  overtime_max_hours_per_year: number;
  night: { start: string; end: string };
  week_starts_on: number;
  holidays: {
    fixed: { date: string; name: string }[];
    easter_offsets: { offset: number; name: string }[];
  };
  disclaimer: string;
}

export interface Location {
  id: string;
  name: string;
  closed_weekdays: number[];
  sort_order?: number;
}

export interface ShiftTemplate {
  id: string;
  location_id: string;
  name: string;
  start_time: string; // 'HH:MM' ili 'HH:MM:SS'
  end_time: string;
  active?: boolean;
  sort_order?: number;
}

export interface Employee {
  id: string;
  name: string;
  weekly_hours: number;
  active?: boolean;
}

export interface Assignment {
  date: DateStr;
  shift_template_id: string;
  employee_id: string;
}

export type AbsenceType = "godisnji" | "slobodan" | "bolovanje";

export interface Absence {
  id?: string;
  employee_id: string;
  date_from: DateStr;
  date_to: DateStr;
  type: AbsenceType;
}

export interface Unavailability {
  id?: string;
  employee_id: string;
  date: DateStr | null;
  weekday: number | null;
  note?: string | null;
}

export interface Closure {
  location_id: string;
  date: DateStr;
}

export type Severity = "red" | "yellow" | "info";

export type WarningKind =
  | "daily_rest"
  | "weekly_rest"
  | "break"
  | "overtime_year"
  | "double_booking"
  | "uncovered"
  | "unmarked"
  | "unavailable"
  | "absent";

export interface Warning {
  kind: WarningKind;
  severity: Severity;
  date: DateStr;
  /** Ćelija: id predloška smjene, ili 'free' za stupac Slobodno / GO. */
  cell: string;
  employee_id?: string;
  message: string;
}

export interface ScheduleData {
  rules: LaborRules;
  employees: Employee[];
  locations: Location[];
  templates: ShiftTemplate[];
  /** Raspored. Za točna upozorenja uključi barem 14 dana prije i 7 poslije raspona, a za prekovremene od 1.1. */
  assignments: Assignment[];
  absences: Absence[];
  availability: Unavailability[];
  closures: Closure[];
}

export const ABSENCE_LABEL: Record<AbsenceType, string> = {
  godisnji: "GO",
  slobodan: "Slobodan",
  bolovanje: "Bolovanje",
};
