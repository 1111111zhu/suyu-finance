import {createHash} from 'node:crypto';
import {cleanPolicyText} from './policy-time.mjs';
export function candidateContentHash(p) {
  return createHash('sha256').update(JSON.stringify([p.content || '',(p.attachments || []).map(a=>[a.url,a.status])])).digest('hex');
}
export function expandApplicationItems(candidates) {
  const result=[];
  for (const parent of candidates) {
    const items=parent.applicationItems || [];
    result.push({...parent,containerOnly:items.length > 0});
    for (const item of items) {
      if (!item.id || !item.title || !item.content || !item.sourceEvidence?.excerpt || !cleanPolicyText(parent.content).includes(cleanPolicyText(item.content)) || !cleanPolicyText(parent.content).includes(cleanPolicyText(item.sourceEvidence.excerpt))) throw new Error(`细分事项缺少原文定位，不能静默跳过：${parent.id}/${item.id || '?'}`);
      const bound=parent.originalVerification?.bindingStatus === 'matched' && cleanPolicyText(parent.content).includes(cleanPolicyText(item.title));
      const child={...parent,...item,id:`${parent.id}::${item.id}`,url:parent.url,parentProjectId:parent.id,applicationItemId:item.id,applicationItems:undefined,containerOnly:false,qualificationReviews:item.qualificationReviews || {},originalVerification:{...parent.originalVerification,bindingStatus:bound?'matched':'unknown',titleMatched:bound}};
      // Sibling/parent deadlines and reviews cannot establish this item's window.
      Object.assign(child,{deadline:item.deadline || '',deadlineTime:item.deadlineTime || '',deadlineEvidence:item.deadlineEvidence || '',applicationWindows:item.applicationWindows || [],timing:undefined,applicationContent:item.content});
      child.contentHash=candidateContentHash(child);
      result.push(child);
    }
  }
  return result;
}
