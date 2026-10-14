export const payrollTagIds = Object.freeze(['25', '33']);
export function memberRole(member, managerTag, departments, financeId, payrollTags = []) {
  if (member.status !== 1) return 'none';
  const explicit = tag => (tag?.userlist || []).some(user => user.userid === member.userid);
  if (explicit(managerTag)) return 'manager';
  const descendants = new Set([Number(financeId)]);
  for (let n = 0; n < departments.length; n++) for (const department of departments)
    if (descendants.has(Number(department.parentid))) descendants.add(Number(department.id));
  const finance = (member.department || []).some(id => descendants.has(Number(id)));
  return finance ? 'finance' : 'none';
}
export function roleCapabilities(role) {
  return {rd: ['manager', 'finance', 'finance_payroll'].includes(role),
    payroll: role === 'manager'};
}
export function roleAllows(role, capability, path) {
  const capabilities = roleCapabilities(role);
  if (!capabilities[capability]) return false;
  return true;
}
