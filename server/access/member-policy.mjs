export const payrollTagIds = Object.freeze(['25', '33']);
export function memberRole(member, managerTag, departments, financeId, payrollTags = []) {
  if (member.status !== 1) return 'none';
  const explicit = tag => (tag?.userlist || []).some(user => user.userid === member.userid);
  if (explicit(managerTag)) return 'manager';
  const descendants = new Set([Number(financeId)]);
  for (let n = 0; n < departments.length; n++) for (const department of departments)
    if (descendants.has(Number(department.parentid))) descendants.add(Number(department.id));
  const finance = (member.department || []).some(id => descendants.has(Number(id)));
  const payroll = payrollTags.some(explicit);
  return finance ? (payroll ? 'finance_payroll' : 'finance') : (payroll ? 'payroll' : 'none');
}
export function roleCapabilities(role) {
  return {rd: ['manager', 'finance', 'finance_payroll'].includes(role),
    payroll: ['manager', 'payroll', 'finance_payroll'].includes(role)};
}
export function roleAllows(role, capability, path) {
  const capabilities = roleCapabilities(role);
  if (!capabilities[capability]) return false;
  // Existing research write/export routes use the payroll gate, but only managers
  // can use that gate outside the actual salary application.
  if (capability === 'payroll' && role !== 'manager')
    return /^\/(?:salary(?:\/|$)|salary-directory|salary-preview|api\/payroll\/)/.test(path);
  return true;
}
