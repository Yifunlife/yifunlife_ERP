import {env} from 'cloudflare:workers';
import {getLoginSession} from '../../../lib/auth';
import {sameOrigin} from '../../../lib/hotmail';
import {accessibleQuotation,quotationSourceError} from '../../../lib/quotation-source';
import {sharedQuotation,bridgeMessage} from '../../../lib/crm-collaboration';
const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
export async function GET(request:Request){
 const session=await getLoginSession(request);if(!session)return reply({error:'请先登录报价系统'},401);
 const id=new URL(request.url).searchParams.get('quotation')||'';
 const own=await accessibleQuotation(id,session),shared=!own&&await sharedQuotation(env.DB,id,session.email);
 if(!own&&!shared)return reply({error:'报价不存在或无权查看'},404);
 const quote=await env.DB.prepare('SELECT id,contract_no,project_name,customer_name,created_by,generated_at,is_finalized,final_amount,final_currency,voided_at,archived_at,project_status FROM quotation_history WHERE id=?').bind(id).first<any>();
 if(!quote)return reply({error:'报价不存在'},404);
 const link=await env.DB.prepare('SELECT project_id,project_name,contract_no,sales_name,updated_at FROM quotation_crm_links WHERE quotation_id=? AND active=1').bind(id).first();
 const messages=(await env.DB.prepare('SELECT id,direction,kind,body_json,author,created_at FROM quotation_crm_messages WHERE quotation_id=? ORDER BY created_at DESC,id DESC LIMIT 200').bind(id).all<any>()).results.map(({body_json,...m})=>({...m,body:JSON.parse(body_json)}));
 return reply({quote,link,messages,canPublish:!!own&&!quote.voided_at&&!quote.archived_at&&quote.project_status!=='lost'});
}
export async function POST(request:Request){
 const session=await getLoginSession(request);if(!session)return reply({error:'请先登录'},401);if(!sameOrigin(request))return reply({error:'请求来源无效'},403);
 const id=new URL(request.url).searchParams.get('quotation')||'',quote=await accessibleQuotation(id,session);if(!quote)return reply({error:'无权提交本报价'},404);
 const sourceError=await quotationSourceError(id,session);if(sourceError)return reply({error:sourceError},409);
 if(!quote.snapshotJson)return reply({error:'请先保存完整报价版本'},400);
 let body:any,payload:any;try{const raw=await request.text();if(raw.length>12000)throw Error('内容过长');body=JSON.parse(raw);payload=bridgeMessage(body);}catch(e:any){return reply({error:e.message||'内容无效'},400);}
 const link=await env.DB.prepare('SELECT project_id FROM quotation_crm_links WHERE quotation_id=? AND active=1').bind(id).first<any>();
 const key=body.kind==='核算报价完成'?'ready-'+id:'reply-'+body.requestId;
 await env.DB.prepare('INSERT OR IGNORE INTO quotation_crm_messages(id,quotation_id,project_id,direction,kind,body_json,author,created_at) VALUES(?,?,?,\'quote\',?,?,?,?)').bind(key,id,link?.project_id||'',body.kind,JSON.stringify(payload),session.email,new Date().toISOString()).run();
 return reply({ok:true,message:link?'已提交；CRM将在下一轮检查通知本项目销售。':'已提交；待CRM按项目名和合同号核对关联后通知销售。'});
}
