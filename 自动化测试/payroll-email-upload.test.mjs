import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
function page(grid) {
  const elements=new Map();
  const element=()=>({value:'',textContent:'',innerHTML:'',children:[],listeners:{},files:[],append(...items){this.children.push(...items);},replaceChildren(...items){this.children=items;if(items[0]?.value)this.value=items[0].value;},addEventListener(event,handler){this.listeners[event]=handler;},dataset:{}});
  const get=id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id);};
  const context=vm.createContext({console,Date,Blob,document:{getElementById:get,createElement:element,querySelectorAll:()=>get('sections').children.map(section=>section.children[1])},navigator:{clipboard:{writeText:async()=>{}}},XLSX:{read:()=>({SheetNames:['工资表'],Sheets:{工资表:{}}}),utils:{sheet_to_json:()=>grid}}});
  for(const file of ['payroll-engine.js','payroll-email-engine.js','email-page.js'])vm.runInContext(fs.readFileSync(new URL(`../public/salary/${file}`,import.meta.url),'utf8'),context);
  get('company').value='溯驭技术';get('name').value='董博';get('file').files=[{arrayBuffer:async()=>new ArrayBuffer(0)}];
  return {get,upload:()=>get('file').listeners.change()};
}
test('standalone final-payroll upload generates leave tables without running calculation',async()=>{
  const {get,upload}=page([['姓名','实发工资','公司总成本','一级部门','年假天数','调休假天数'],['甲',100,150,'研发',1,.5]]);
  await upload();
  assert.match(get('body').value,/甲\t0.5/);
  assert.match(get('body').value,/本月合计发薪成本150.00元/);
  assert.match(get('preview').innerHTML,/<table/);
});
test('missing costs remain pending and invalid sheets clear the previous body',async()=>{
  const {get,upload}=page([['姓名','实发工资'],['甲',100]]);await upload();
  assert.match(get('body').value,/合计发薪成本待核对/);
  assert.match(get('status').textContent,/缺少公司总成本/);
  const bad=page([['姓名','应发工资'],['甲',100]]);await bad.upload();
  assert.equal(bad.get('body').value,'');assert.match(bad.get('status').textContent,/需要包含姓名、实发工资/);
});
