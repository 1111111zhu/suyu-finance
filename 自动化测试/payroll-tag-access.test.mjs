import test from 'node:test';
import assert from 'node:assert/strict';
import {memberRole,roleCapabilities,roleAllows} from '../server/access/member-policy.mjs';
import {routeCapability} from '../server/access/policy.mjs';
test('finance may calculate import and export RD; only managers may access payroll',()=>{
 const member={userid:'u',status:1,department:[11]},tags=[{userlist:[{userid:'u'}]}];
 assert.equal(memberRole(member,{},[{id:11,parentid:10}],10,tags),'finance');
 assert.equal(memberRole({...member,department:[99]}, {},[],10,tags),'none');
 for(const role of ['finance','finance_payroll']){
  assert.deepEqual(roleCapabilities(role),{rd:true,payroll:false});
  for(const path of ['/rd-cost','/rd-cost/analysis','/api/rd/compute','/api/rd/compute/job','/api/rd/image-import','/api/rd/image-workbook','/api/rd/export','/api/rd/analysis/imports','/api/rd/projects'])
   for(const method of ['GET','POST','PUT'])assert.equal(roleAllows(role,routeCapability(path,method),path),true,path);
  for(const path of ['/salary/index.html','/salary-preview/index.html','/api/payroll/workspaces'])assert.equal(roleAllows(role,routeCapability(path),path),false,path);
 }
 assert.deepEqual(roleCapabilities('payroll'),{rd:false,payroll:false});
 assert.equal(memberRole(member,tags[0],[],10,tags),'manager');
 assert.equal(roleAllows('manager','payroll','/api/payroll/workspaces'),true);
});
