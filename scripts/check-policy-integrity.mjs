import {readFile} from 'node:fs/promises';
import {assertViablePolicyFeed} from './policy-feed.mjs';
import {RULES_VERSION} from './policy-integrity.mjs';
import {assertPolicyRulesLoaded, loadPolicyRules} from './policy-rules.mjs';
const feed = assertViablePolicyFeed(JSON.parse(await readFile('public/policies.json','utf8')));
const ruleDocument = assertPolicyRulesLoaded(await loadPolicyRules());
if (feed.rulesVersion !== RULES_VERSION) throw new Error('公开数据执行规则版本和程序版本不一致');
console.log(JSON.stringify({rulesVersion:feed.rulesVersion,ruleDocumentVersion:ruleDocument.version,ruleDocumentDigest:ruleDocument.digest,candidates:feed.sourceCandidateCount,collections:feed.collectionCounts,coverage:feed.coverage.status,conservation:'passed'},null,2));
