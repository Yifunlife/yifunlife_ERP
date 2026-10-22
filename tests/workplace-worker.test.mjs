import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createWorker,fixturePassword} from './support/worker.mjs';

test('built worker links a saved quotation to the shared project and rejects another employee',async()=>{
 const {worker,db}=await createWorker({WORKPLACE_SYNC_TOKEN:'fixture-secret-only'});
 try{
  const invoke=(path,method='GET',payload,headers={})=>worker.dispatchFetch('https://review.test'+path,{method,headers:{'Content-Type':'application/json',...headers},...(payload?{body:JSON.stringify(payload)}:{})});
  assert.equal((await invoke('/api/workplace-sync?kind=products')).status,401);
  assert.equal((await invoke('/api/workplace-sync','POST',{projects:[{id:'project-one',name:'Shared project',customer_name:'Fixture customer',allowed_emails:['alice@example.test']}]},{Authorization:'Bearer fixture-secret-only'})).status,200);
  for(const email of ['alice@example.test','bob@example.test']){
   const login=await invoke('/api/auth/login','POST',{email,password:fixturePassword});
   assert.equal(login.status,200,await login.clone().text());
   const Cookie=login.headers.get('set-cookie').split(';')[0];
   const context=await invoke('/api/workplace-project?id=project-one','GET',null,{Cookie});
   assert.equal(context.status,email.startsWith('alice')?200:403);
   const saved=await invoke('/api/quotation-history','POST',{contractNo:'TEST-Q',projectName:'Shared project',snapshot:{version:1,workspaceProjectId:'project-one',products:[],cart:{},priceMode:'vip'}},{Cookie});
   assert.equal(saved.status,email.startsWith('alice')?201:403,await saved.clone().text());
  }
  const exported=await (await invoke('/api/workplace-sync?kind=quotations','GET',null,{Authorization:'Bearer fixture-secret-only'})).json();
  assert.equal(exported.items.length,1);assert.equal(exported.items[0].workspace_project_id,'project-one');
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM quotation_history').first()).n,1);
 }finally{await worker.dispose()}
});
