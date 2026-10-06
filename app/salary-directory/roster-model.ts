export type Issue = { field: string; reason: string; message: string };
export type RawRow = Record<string, string | number | boolean | null>;
export type Normalized = { values: Record<string, string | boolean>; sources: Record<string, string>; issues: Issue[] };
export type Engine = {
  rosterFields: [string, string, string[]][];
  rosterFieldMap(headers: string[]): { map: Record<string, string>; issues: Issue[] };
  normalizeRosterRow(row: RawRow, mapping: { map: Record<string, string>; issues: Issue[] }): Normalized;
};
export type SourceSheet = { name: string; headers: string[]; rows: { raw: RawRow; number: number }[]; headerRow: number };
export type Person = Normalized & { raw: RawRow; number: number; eligible: boolean };
export type Role = "active" | "left";
export const roleWord = (role: Role) => role === "active" ? "在职" : "离职";

export function previousPayrollMonth(now = new Date()) {
  const parts = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit" }).formatToParts(now);
  const year = Number(parts.find(part => part.type === "year")?.value);
  const month = Number(parts.find(part => part.type === "month")?.value);
  return `${month === 1 ? year - 1 : year}-${String(month === 1 ? 12 : month - 1).padStart(2,"0")}`;
}

export function occursInPayrollMonth(date: unknown, month: string) {
  if (typeof date !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return false;
  const matched = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!matched || date.slice(0,7) !== month) return false;
  const year=Number(matched[1]), m=Number(matched[2]), day=Number(matched[3]);
  return day >= 1 && day <= new Date(Date.UTC(year,m,0)).getUTCDate();
}

// Roles are selected by explicit sheet names, never by the number of columns.
export function pickSheet(sheets: SourceSheet[], role: Role) {
  const matches = sheets.filter(sheet => sheet.name.includes(roleWord(role)) && (role !== "active" || !sheet.name.includes("离职")));
  return matches.length === 1 ? matches[0].name : "";
}

export function parseSheet(name: string, grid: unknown[][], engine: Engine): SourceSheet | null {
  for (let i = 0; i < Math.min(grid.length, 20); i++) {
    const rawHeaders = grid[i].map(value => String(value ?? "").trim());
    const counts = new Map<string, number>();
    rawHeaders.forEach(header => counts.set(header, (counts.get(header) ?? 0) + 1));
    const headers = rawHeaders.map((header, column) => counts.get(header)! > 1 ? `${header}〔第${column + 1}列〕` : header);
    if (!engine.rosterFieldMap(headers).map.name) continue;
    return { name, headers: headers.filter(Boolean), headerRow: i + 1,
      rows: grid.slice(i + 1).flatMap((cells, index) => cells.some(cell => String(cell ?? "").trim()) ? [{
        number: i + index + 2,
        raw: Object.fromEntries(headers.flatMap((header, column) => header ? [[header, (cells[column] ?? null) as RawRow[string]]] : [])),
      }] : []),
    };
  }
  return null;
}

export function preparePeople(sheet: SourceSheet | undefined, role: Role, engine: Engine | null, overrides: Record<string, string> = {}) {
  if (!sheet || !engine) return { people: [] as Person[], excluded: [] as Person[], map: {} as Record<string, string>, issues: [] as Issue[] };
  const detected = engine.rosterFieldMap(sheet.headers);
  const map = { ...detected.map, ...overrides };
  const issues = detected.issues.filter(issue => !Object.hasOwn(overrides, issue.field));
  const people: Person[] = [], excluded: Person[] = [];
  for (const row of sheet.rows) {
    const rawStatus = String(row.raw[map.status] ?? "").trim();
    const status = roleWord(role);
    // A row mentioning both statuses remains an explicit review item.
    const explicit = rawStatus.includes(status) && !rawStatus.includes(roleWord(role === "active" ? "left" : "active"));
    const raw = explicit ? { ...row.raw, [map.status]: status } : row.raw;
    const normalized = engine.normalizeRosterRow(raw, { map, issues });
    // New hires belong to the active sheet and must keep their joining payroll rules.
    const eligible = role === "active" ? ["在职", "入职"].includes(String(normalized.values.status)) : normalized.values.status === "离职";
    const person: Person = { ...normalized, raw, number: row.number, eligible };
    (eligible ? people : excluded).push(person);
  }
  const names = new Map<string, number[]>();
  people.forEach(person => { const name = String(person.values.name ?? ""); if (name) names.set(name, [...(names.get(name) ?? []), person.number]); });
  for (const [name, rows] of names) if (rows.length > 1) issues.push({ field: "name", reason: "duplicate", message: `${name}在第 ${rows.join("、")} 行重复；工资表按姓名关联，请先核对。` });
  return { people, excluded, map, issues };
}

export function salaryRows(people: Person[], engine: Engine) {
  return people.map(person => Object.fromEntries(engine.rosterFields.flatMap(([field, label]) => {
    const raw = person.raw[person.sources[field]];
    const value = ["bankCard", "bankName"].includes(field) ? raw : person.values[field];
    return value === undefined || value === null || value === "" ? [] : [[label, value]];
  })) as RawRow);
}
