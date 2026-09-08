export { evaluateProject as evaluatePolicy } from "./project-assessment.mjs";
import { evaluateProject } from "./project-assessment.mjs";

export function auditPolicies(policies, now = new Date(), companyProfile = null) {
  return policies.map(policy => ({ ...policy, ...evaluateProject(policy, now, companyProfile) }));
}

export function filterAndRankPolicies(policies, now = new Date(), companyProfile = null) {
  return auditPolicies(policies, now, companyProfile).filter(policy => policy.visible);
}
