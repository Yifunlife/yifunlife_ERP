import { env } from "cloudflare:workers";
import { getLoginSession } from "./auth";

type SharedProject = { id: string; name: string; customer_name: string; allowed_emails: string; active: number };
const privileged = (role: string) => ["admin", "management", "ceo"].includes(role);
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function workplaceProject(request: Request, id: string) {
  const session = await getLoginSession(request);
  if (!session) return null;
  const project = await env.DB.prepare("SELECT * FROM workplace_projects WHERE id=? AND active=1").bind(id).first<SharedProject>();
  if (!project || (!privileged(session.role) && !JSON.parse(project.allowed_emails).includes(session.email.toLowerCase()))) return null;
  return { id: project.id, name: project.name, customerName: project.customer_name };
}

export async function handleWorkplace(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/api/workplace-project") {
    if (request.method !== "GET") return reply({ error: "Method not allowed" }, 405);
    const project = await workplaceProject(request, url.searchParams.get("id") || "");
    return project ? reply({ project }) : reply({ error: "请登录，并确认你已加入该 Workplace 项目。" }, 403);
  }
  const secret = (env as unknown as { WORKPLACE_SYNC_TOKEN?: string }).WORKPLACE_SYNC_TOKEN;
  const token = request.headers.get("Authorization")?.replace(/^Bearer /, "") || "";
  const digest = async (value: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  const [expected, actual] = await Promise.all([digest(secret || ""), digest(token)]);
  if (!secret || expected.some((byte, index) => byte !== actual[index])) return reply({ error: "Unauthorized" }, 401);
  if (request.method === "GET") {
    const kind = url.searchParams.get("kind"), after = url.searchParams.get("after") || "";
    let rows;
    if (kind === "products") {
      rows = await env.DB.prepare(`SELECT c.id,c.sku,COALESCE(o.name,c.name) name,c.english_name,
        COALESCE(o.specification,c.specification) specification,COALESCE(o.unit,c.unit) unit,c.image_key
        FROM catalog_products c LEFT JOIN product_overrides o ON o.product_id=c.id WHERE c.id>? ORDER BY c.id LIMIT 100`).bind(after).all();
    } else if (kind === "quotations") {
      rows = await env.DB.prepare(`SELECT id,contract_no,project_name,created_by,generated_at,is_finalized,
        final_amount,final_currency,archived_at,voided_at,project_status,
        CASE WHEN json_valid(snapshot_json) THEN json_extract(snapshot_json,'$.workspaceProjectId') END workspace_project_id
        FROM quotation_history WHERE id>? ORDER BY id LIMIT 100`).bind(after).all();
    } else return reply({ error: "Unknown record type" }, 400);
    return reply({ items: rows.results, next: rows.results.length === 100 ? rows.results[99].id : null });
  }
  if (request.method === "POST") {
    if (Number(request.headers.get("Content-Length") || 0) > 2_000_000) return reply({ error: "资料过大" }, 413);
    const raw = await request.text();
    if (raw.length > 2_000_000) return reply({ error: "资料过大" }, 413);
    let payload;
    try { payload = JSON.parse(raw); } catch { return reply({ error: "资料格式不正确" }, 400); }
    if (!Array.isArray(payload.projects) || payload.projects.length > 1000) return reply({ error: "项目列表格式不正确" }, 400);
    const ids = new Set<string>();
    for (const p of payload.projects) {
      if (!p || typeof p.id !== "string" || !p.id || p.id.length > 128 || ids.has(p.id) ||
          typeof p.name !== "string" || !p.name.trim() || p.name.length > 4000 ||
          typeof p.customer_name !== "string" || p.customer_name.length > 4000 ||
          !Array.isArray(p.allowed_emails) || p.allowed_emails.length > 100 ||
          p.allowed_emails.some((email: unknown) => typeof email !== "string" || email.length > 254 || !email.includes("@"))) {
        return reply({ error: "项目资料或成员格式不正确" }, 400);
      }
      ids.add(p.id);
    }
    await env.DB.batch([
      env.DB.prepare("UPDATE workplace_projects SET active=0"),
      ...payload.projects.map((p: { id: string; name: string; customer_name: string; allowed_emails: string[] }) =>
        env.DB.prepare(`INSERT INTO workplace_projects(id,name,customer_name,allowed_emails,active) VALUES(?,?,?,?,1)
          ON CONFLICT(id) DO UPDATE SET name=excluded.name,customer_name=excluded.customer_name,allowed_emails=excluded.allowed_emails,active=1`)
          .bind(p.id, p.name, p.customer_name, JSON.stringify(p.allowed_emails.map(email => email.toLowerCase())))),
    ]);
    return reply({ ok: true, projects: ids.size });
  }
  return reply({ error: "Method not allowed" }, 405);
}
