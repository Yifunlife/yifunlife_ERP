const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createRuntime } = require('./support/runtime.cjs');
test('employees change only their own password with old-password validation; six characters accepted', async () => {
 const r=createRuntime({realAuth:true});
 try {
  const auth=r.load('lib/auth.ts');const route=r.load('app/api/profile/route.ts');
  for(const username of ['yw003','yw004'])await r.db.insert(r.schema.appUsers).values({email:username,username,name:username,role:'employee',status:'active',...(await auth.createPasswordRecord(username)),createdAt:'now',updatedAt:'now'});
  const {token}=await auth.createLoginSession('yw003');const second=await auth.createLoginSession('yw003');
  const headers={cookie:`yifun_session=${token}`,'content-type':'application/json'};
  const req=body=>new Request('https://test/api/profile',{method:'PATCH',headers,body:JSON.stringify(body)});
  assert.equal((await route.PATCH(new Request('https://test',{method:'PATCH',body:'{}'}))).status,401);
  assert.equal((await route.PATCH(req({currentPassword:'wrong',password:'123456',confirmPassword:'123456'}))).status,400);
  assert.equal((await route.PATCH(req({currentPassword:'yw003',password:'12345',confirmPassword:'12345'}))).status,400);
  assert.equal((await route.PATCH(req({currentPassword:'yw003',password:'123456',confirmPassword:'654321'}))).status,400);
  const profile=await route.GET(new Request('https://test',{headers}));assert.equal((await profile.json()).user.username,'yw003');
  const response=await route.PATCH(req({email:'yw004',currentPassword:'yw003',password:'123456',confirmPassword:'123456'}));assert.equal(response.status,200);
  assert.match(response.headers.get('set-cookie'),/Max-Age=0/);
  const user=r.sqlite.prepare('SELECT * FROM app_users WHERE email=?').get('yw003');assert.ok(await auth.passwordMatches('123456',user.password_hash,user.password_salt));
  const other=r.sqlite.prepare('SELECT * FROM app_users WHERE email=?').get('yw004');assert.ok(await auth.passwordMatches('yw004',other.password_hash,other.password_salt));
  for(const session of [token,second.token])assert.equal(await auth.getLoginSession(new Request('https://test',{headers:{cookie:`yifun_session=${session}`}})),null);
 }finally{r.close();}
});
