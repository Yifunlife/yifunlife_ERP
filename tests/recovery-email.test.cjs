const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createRuntime } = require('./support/runtime.cjs');
test('verified email binding preserves usernames and owner keys; recovery checks ownership, expiry and token reuse', async () => {
 const r=createRuntime({realAuth:true});const originalFetch=global.fetch;const mail=[];
 try {
  r.bindings.BREVO_API_KEY='fixture-only';
  global.fetch=async (url, options)=>{assert.equal(url,'https://api.brevo.com/v3/smtp/email');mail.push(JSON.parse(options.body));return new Response('{}',{status:201});};
  const auth=r.load('lib/auth.ts');
  for(const username of [auth.ADMIN_EMAIL,'yw003','yw004'])await r.db.insert(r.schema.appUsers).values({email:username,username,name:username,role:username===auth.ADMIN_EMAIL?'admin':'employee',status:'active',...(await auth.createPasswordRecord('123456')),createdAt:'now',updatedAt:'now'});
  const bind=r.load('app/api/profile/email/route.ts');const forgot=r.load('app/api/auth/request-reset/route.ts');const reset=r.load('app/api/auth/reset-password/route.ts');
  const {token}=await auth.createLoginSession('yw003');const second=await auth.createLoginSession('yw004');
  const request=(body,other=false)=>new Request('https://review.test/api/profile/email',{method:'POST',headers:{cookie:`yifun_session=${other?second.token:token}`,'content-type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await bind.POST(request({email:'recover@example.test',currentPassword:'wrong'}))).status,400);
  assert.equal((await bind.POST(request({email:'recover@example.test',currentPassword:'123456'}))).status,200);
  assert.equal((await bind.POST(request({email:'recover@example.test',currentPassword:'123456'}))).status,429);
  const code=mail[0].textContent.match(/\d{6}/)[0];
  assert.equal((await forgot.POST(request({email:'recover@example.test'}))).status,200);assert.equal(mail.length,1);
  assert.equal((await bind.PATCH(request({code}))).status,200);
  const stored=r.sqlite.prepare("SELECT * FROM app_users WHERE email='yw003'").get();assert.equal(stored.username,'yw003');assert.equal(stored.recovery_email,'recover@example.test');assert.ok(stored.recovery_email_verified_at);
  assert.equal((await bind.PATCH(request({code}))).status,400);
  assert.equal((await bind.POST(request({email:'recover@example.test',currentPassword:'123456'},true))).status,409);
  assert.equal((await forgot.POST(request({email:'recover@example.test'}))).status,200);assert.equal(mail.length,2);assert.equal(mail[1].to[0].email,'recover@example.test');
  await forgot.POST(request({email:'recover@example.test'}));assert.equal(mail.length,2);
  const resetToken=new URL(mail[1].textContent.match(/https:\/\/\S+/)[0]).searchParams.get('reset');
  assert.equal((await reset.POST(request({token:resetToken,password:'654321'}))).status,200);
  assert.equal((await reset.POST(request({token:resetToken,password:'999999'}))).status,400);
  assert.equal(await auth.getLoginSession(request({})),null);
  const updated=r.sqlite.prepare("SELECT * FROM app_users WHERE email='yw003'").get();assert.ok(await auth.passwordMatches('654321',updated.password_hash,updated.password_salt));
  const other=r.sqlite.prepare("SELECT * FROM app_users WHERE email='yw004'").get();assert.ok(await auth.passwordMatches('123456',other.password_hash,other.password_salt));
  const concurrentToken=await auth.createPasswordReset('yw004');
  const concurrent=await Promise.all([reset.POST(request({token:concurrentToken,password:'123456'})),reset.POST(request({token:concurrentToken,password:'123456'}))]);
  assert.deepEqual(concurrent.map(response=>response.status).sort(),[200,400]);
  const expired=await auth.createPasswordReset('yw004');r.sqlite.prepare("UPDATE password_reset_tokens SET expires_at='2000-01-01' WHERE email='yw004'").run();assert.equal((await reset.POST(request({token:expired,password:'654321'}))).status,400);
 } finally {global.fetch=originalFetch;r.close();}
});
test('verification limits guesses and cannot be completed by a different account', async () => {
 const r=createRuntime({realAuth:true});const originalFetch=global.fetch;let code;
 try {
  r.bindings.BREVO_API_KEY='fixture-only';global.fetch=async (_,options)=>{code=JSON.parse(options.body).textContent.match(/\d{6}/)[0];return new Response('{}',{status:201});};
  const auth=r.load('lib/auth.ts');const route=r.load('app/api/profile/email/route.ts');const tokens=[];
  for(const username of ['a','b']){await r.db.insert(r.schema.appUsers).values({email:username,username,name:username,role:'employee',status:'active',...(await auth.createPasswordRecord('123456')),createdAt:'now',updatedAt:'now'});tokens.push((await auth.createLoginSession(username)).token);}
  const request=(body,index=0)=>new Request('https://test',{method:'POST',headers:{cookie:`yifun_session=${tokens[index]}`},body:JSON.stringify(body)});
  await route.POST(request({email:'a@example.test',currentPassword:'123456'}));
  assert.equal((await route.PATCH(request({code},1))).status,400);
  for(let i=0;i<5;i++)assert.equal((await route.PATCH(request({code:code==='000000'?'111111':'000000'}))).status,400);
  assert.equal((await route.PATCH(request({code}))).status,400);
  assert.equal(r.sqlite.prepare("SELECT recovery_email FROM app_users WHERE email='a'").get().recovery_email,null);
 }finally{global.fetch=originalFetch;r.close();}
});
