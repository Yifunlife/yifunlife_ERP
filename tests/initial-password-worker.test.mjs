import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorker, fixturePassword } from './support/worker.mjs';
test('initial password blocks business pages and APIs until changed; existing custom passwords stay usable', async () => {
 const {worker,db}=await createWorker();
 try {
  await db.prepare("UPDATE app_users SET must_change_password=1 WHERE email='alice@example.test'").run();
  const login=async (username,password)=>worker.dispatchFetch('https://test/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username,password})});
  const initial=await login('alice@example.test',fixturePassword);assert.equal(initial.status,200);assert.equal((await initial.json()).mustChangePassword,true);
  const cookie=initial.headers.get('set-cookie').split(';')[0];const headers={cookie,'content-type':'application/json'};
  const page=await worker.dispatchFetch('https://test/quotation-history',{headers,redirect:'manual'});assert.equal(page.status,303);assert.equal(new URL(page.headers.get('location')).pathname,'/profile');
  assert.equal((await worker.dispatchFetch('https://test/api/quotation-history',{headers})).status,403);
  assert.equal((await worker.dispatchFetch('https://test/profile',{headers})).status,200);
  const change=await worker.dispatchFetch('https://test/api/profile',{method:'PATCH',headers,body:JSON.stringify({currentPassword:fixturePassword,password:'654321',confirmPassword:'654321'})});assert.equal(change.status,200);
  const next=await login('alice@example.test','654321');assert.equal((await next.json()).mustChangePassword,false);
  const nextCookie=next.headers.get('set-cookie').split(';')[0];assert.equal((await worker.dispatchFetch('https://test/api/quotation-history',{headers:{cookie:nextCookie}})).status,200);
  const unchanged=await login('bob@example.test',fixturePassword);assert.equal((await unchanged.json()).mustChangePassword,false);
  const admin=await login('yifunlife@hotmail.com',fixturePassword);const adminCookie=admin.headers.get('set-cookie').split(';')[0];
  const newUser=await worker.dispatchFetch('https://test/api/admin/users',{method:'POST',headers:{cookie:adminCookie,'content-type':'application/json'},body:JSON.stringify({users:[{username:'firstlogin',name:'First',password:'123456'}]})});assert.equal(newUser.status,200);
  const created=await login('firstlogin','123456');assert.equal((await created.json()).mustChangePassword,true);
 }finally{await worker.dispose();}
});
