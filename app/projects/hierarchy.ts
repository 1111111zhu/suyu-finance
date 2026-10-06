export type ProjectCode = { number: string; parentNumber?: string | null };

export type ProjectHierarchyRow<T extends ProjectCode> = {
  project: T;
  level: number;
  parentCode: string | null;
  childCount: number;
  isLastSibling: boolean;
};

/**
 * A project such as RD141031-1 is a child only when RD141031 exists in the
 * same platform. Codes without their parent record remain top-level projects:
 * a hyphen alone must never invent a relationship.
 */
export function buildProjectHierarchy<T extends ProjectCode>(projects: T[]): ProjectHierarchyRow<T>[] {
  const byCode = new Map(projects.map((project) => [project.number.toUpperCase(), project]));
  const children = new Map<string, T[]>();
  const roots: T[] = [];

  for (const project of projects) {
    const match = project.number.match(/^(.*)-(\d+)$/);
    const parentCode = (project.parentNumber === undefined ? match?.[1] : project.parentNumber)?.toUpperCase();
    if (!parentCode || parentCode === project.number.toUpperCase() || !byCode.has(parentCode)) {
      roots.push(project);
      continue;
    }
    const group = children.get(parentCode) ?? [];
    group.push(project);
    children.set(parentCode, group);
  }

  const result: ProjectHierarchyRow<T>[] = [];
  const visited = new Set<string>();
  const compare = (a: T, b: T) => a.number.localeCompare(b.number, "en", {numeric: true});
  function append(project: T, level: number, parentCode: string | null, isLastSibling: boolean) {
    if (visited.has(project.number.toUpperCase())) return;
    visited.add(project.number.toUpperCase());
    const descendants = (children.get(project.number.toUpperCase()) ?? []).sort(compare);
    result.push({project, level, parentCode, childCount: descendants.length, isLastSibling});
    descendants.forEach((child, index) => append(child, level + 1, project.number, index === descendants.length - 1));
  }
  roots.sort(compare).forEach((project, index) => append(project, 0, null, index === roots.length - 1));
  // Keep malformed cyclic metadata visible instead of silently losing projects.
  projects.filter(p=>!visited.has(p.number.toUpperCase())).sort(compare).forEach(p=>append(p,0,null,true));
  return result;
}

/** Summation uses own-project amounts once, never a previously aggregated total. */
export function hierarchyTotals<T extends ProjectCode & {actual:number}>(rows:ProjectHierarchyRow<T>[]) {
  const cents = new Map(rows.map(row=>[row.project.number,Math.round(row.project.actual*100)]));
  for (const row of [...rows].reverse()) {
    if(row.parentCode) cents.set(row.parentCode,(cents.get(row.parentCode)??0)+(cents.get(row.project.number)??0));
  }
  return new Map([...cents].map(([code,value])=>[code,value/100]));
}
