const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createRuntime}=require('./support/runtime.cjs');

test('Workplace connector authenticates, paginates and limits published project access',async()=>{
 const r=createRuntime();
 try{
  r.sqlite.exec(fs.readFileSync(path.join(__dirname,'../drizzle/0024_workplace_projects.sql'),'utf8'));
  r.bindings.WORKPLACE_SYNC_TOKEN='fixture-connector-secret';
  const route=r.load('lib/workplace.ts');
  const request=(method='GET',payload,token='fixture-connector-secret',suffix='?kind=products')=>new Request('https://review.test/api/workplace-sync'+suffix,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(payload?{body:JSON.stringify(payload)}:{})});
  assert.equal((await route.handleWorkplace(request('GET',null,'wrong'))).status,401);
  assert.equal((await route.handleWorkplace(request('GET',null,'','?kind=quotations'))).status,401);
  for(let n=0;n<102;n++)r.sqlite.prepare('INSERT INTO catalog_products(id,sku,name) VALUES(?,?,?)').run(String(n).padStart(3,'0'),'SKU-'+n,'Product');
  let page=await (await route.handleWorkplace(request())).json();assert.equal(page.items.length,100);assert.equal(page.next,'099');
  page=await (await route.handleWorkplace(request('GET',null,'fixture-connector-secret','?kind=products&after=099'))).json();assert.equal(page.items.length,2);assert.equal(page.next,null);
  let result=await route.handleWorkplace(request('POST',{projects:[{id:'project-a',name:'Project A',customer_name:'Client',allowed_emails:['alice@example.test']}]}));assert.equal(result.status,200);
  result=await route.handleWorkplace(request('POST',{projects:[{id:'project-b',name:'bad',customer_name:'Client',allowed_emails:'*'}]}));assert.equal(result.status,400);
  assert.equal(r.sqlite.prepare('SELECT active FROM workplace_projects').get().active,1);
  const auth=r.load('lib/auth.ts');
  for(const [email,role] of [['alice@example.test','employee'],['bob@example.test','employee'],['admin@example.test','admin']]){
   r.sqlite.prepare("INSERT INTO app_users(email,username,name,password_hash,password_salt,role,status,created_at,updated_at) VALUES(?,?,?,'x','x',?,'active','now','now')").run(email,email,email,role);
   const session=await auth.createLoginSession(email);
   const req=new Request('https://review.test/api/workplace-project?id=project-a',{headers:{Cookie:'yifun_session='+session.token}});
   assert.equal((await route.handleWorkplace(req)).status,email.startsWith('bob')?403:200);
  }
  await route.handleWorkplace(request('POST',{projects:[]}));assert.equal(r.sqlite.prepare('SELECT active FROM workplace_projects').get().active,0);
  assert.equal((await route.handleWorkplace(request('GET',null,'fixture-connector-secret','?kind=employees'))).status,400);
 }finally{r.close()}
});

test('Workplace quote export preserves history and omits raw prices and customer conversations',async()=>{
 const r=createRuntime();
 try{
  r.bindings.WORKPLACE_SYNC_TOKEN='fixture-connector-secret';
  r.sqlite.prepare('INSERT INTO quotation_history(id,contract_no,project_name,created_by,generated_at,snapshot_json) VALUES(?,?,?,?,?,?)').run('q1','Q1','Project','owner@example.test','2026-09-29',JSON.stringify({workspaceProjectId:'project-a',products:[{cost:999}],cart:{}}));
  const before=r.sqlite.prepare('SELECT snapshot_json FROM quotation_history').get().snapshot_json;
  const response=await r.load('lib/workplace.ts').handleWorkplace(new Request('https://review.test/api/workplace-sync?kind=quotations',{headers:{Authorization:'Bearer fixture-connector-secret'}}));
  const body=await response.json();assert.equal(body.items[0].workspace_project_id,'project-a');assert.equal(body.items[0].snapshot_json,undefined);
  assert.equal(r.sqlite.prepare('SELECT snapshot_json FROM quotation_history').get().snapshot_json,before);
 }finally{r.close()}
});
