import test from 'node:test';
import assert from 'node:assert/strict';
import {memberRole,roleCapabilities,roleAllows,payrollTagIds} from '../server/access/member-policy.mjs';
test('14 and 56 grant salary access outside finance without research access',()=>{
 assert.deepEqual(payrollTagIds,['14','56']);
 const member={userid:'tag-user',status:1,department:[99]};
 for(const tags of [[{userlist:[{userid:'tag-user'}]},{}],[{},{userlist:[{userid:'tag-user'}]}]]) {
  assert.equal(memberRole(member,{},[],10,tags),'payroll');
  assert.deepEqual(roleCapabilities('payroll'),{rd:false,payroll:true});
  assert.equal(roleAllows('payroll','payroll','/api/payroll/workspaces'),true);
  assert.equal(roleAllows('payroll','payroll','/salary/index.html'),true);
  assert.equal(roleAllows('payroll','rd','/api/rd/projects'),false);
  assert.equal(roleAllows('payroll','payroll','/api/rd/export'),false);
 }
 assert.equal(memberRole({...member,status:2},{},[],10,[{userlist:[{userid:'tag-user'}]}]),'none');
 assert.equal(memberRole(member,{},[],10,[{partylist:[99]}]),'none');
 assert.equal(memberRole(member,{},[],10,[]),'none');
});
test('existing finance and manager grants are preserved',()=>{
 const member={userid:'u',status:1,department:[11]},tags=[{userlist:[{userid:'u'}]}];
 assert.equal(memberRole(member,{},[{id:11,parentid:10}],10,tags),'finance_payroll');
 assert.deepEqual(roleCapabilities('finance_payroll'),{rd:true,payroll:true});
 assert.equal(roleAllows('finance_payroll','payroll','/api/rd/export'),false);
 assert.equal(memberRole(member,tags[0],[],10,tags),'manager');
 assert.equal(roleAllows('manager','payroll','/api/rd/export'),true);
});
