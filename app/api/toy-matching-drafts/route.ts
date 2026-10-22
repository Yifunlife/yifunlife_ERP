import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { toyMatchingDrafts } from "../../../db/schema";
import { getLoginSession } from "../../../lib/auth";
import { visibleQuoteSnapshot } from "../../../lib/quote-snapshot";

export const dynamic = "force-dynamic";

const ownerFilter = (email: string) => eq(toyMatchingDrafts.createdBy, email);
const canManageAllDrafts = (role: string) =>
  role === "admin" || role === "management" || role === "ceo";

export async function GET(request: Request) {
  const session = await getLoginSession(request);
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const id = new URL(request.url).searchParams.get("id")?.trim();
  const db = getDb();
  const accessFilter = canManageAllDrafts(session.role)
    ? undefined
    : ownerFilter(session.email);
  if (id) {
    const draft = await db
      .select()
      .from(toyMatchingDrafts)
      .where(and(eq(toyMatchingDrafts.id, id), accessFilter))
      .get();
    if (!draft) return Response.json({ error: "草稿不存在或无权查看" }, { status: 404 });
    try {
      return Response.json({ draft: { ...draft, snapshot: visibleQuoteSnapshot(JSON.parse(draft.snapshotJson), session.role), snapshotJson: undefined } });
    } catch {
      return Response.json({ error: "草稿内容无法读取" }, { status: 422 });
    }
  }

  const drafts = await db
    .select({
      id: toyMatchingDrafts.id,
      name: toyMatchingDrafts.name,
      createdBy: toyMatchingDrafts.createdBy,
      createdAt: toyMatchingDrafts.createdAt,
      updatedAt: toyMatchingDrafts.updatedAt,
    })
    .from(toyMatchingDrafts)
    .where(accessFilter)
    .orderBy(desc(toyMatchingDrafts.updatedAt));
  return Response.json({ drafts });
}

export async function POST(request: Request) {
  const session = await getLoginSession(request);
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const payload = (await request.json()) as { id?: string; name?: string; snapshot?: unknown };
  const name = payload.name?.trim().slice(0, 120) || "玩具匹配草稿";
  if (!payload.snapshot) return Response.json({ error: "没有可保存的匹配内容" }, { status: 400 });
  const snapshotJson = JSON.stringify(payload.snapshot);
  if (snapshotJson.length > 2_000_000)
    return Response.json({ error: "草稿内容过大，无法保存" }, { status: 413 });

  const db = getDb();
  const now = new Date().toISOString();
  const id = payload.id?.trim();
  const accessFilter = canManageAllDrafts(session.role)
    ? undefined
    : ownerFilter(session.email);
  if (id) {
    const existing = await db
      .select({ id: toyMatchingDrafts.id, createdAt: toyMatchingDrafts.createdAt })
      .from(toyMatchingDrafts)
      .where(and(eq(toyMatchingDrafts.id, id), accessFilter))
      .get();
    if (!existing) return Response.json({ error: "草稿不存在或无权保存" }, { status: 404 });
    await db
      .update(toyMatchingDrafts)
      .set({ name, snapshotJson, updatedAt: now })
      .where(eq(toyMatchingDrafts.id, id));
    return Response.json({ draft: { id, name, createdAt: existing.createdAt, updatedAt: now } });
  }

  const draft = {
    id: crypto.randomUUID(),
    createdBy: session.email,
    name,
    snapshotJson,
    createdAt: now,
    updatedAt: now,
  };
  await db.insert(toyMatchingDrafts).values(draft);
  return Response.json({ draft: { id: draft.id, name, createdAt: now, updatedAt: now } }, { status: 201 });
}

export async function DELETE(request: Request) {
  const session = await getLoginSession(request);
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const id = new URL(request.url).searchParams.get("id")?.trim();
  if (!id) return Response.json({ error: "缺少草稿编号" }, { status: 400 });
  const accessFilter = canManageAllDrafts(session.role)
    ? undefined
    : ownerFilter(session.email);
  const result = await getDb()
    .delete(toyMatchingDrafts)
    .where(and(eq(toyMatchingDrafts.id, id), accessFilter));
  if (!result.meta.changes) return Response.json({ error: "草稿不存在或无权删除" }, { status: 404 });
  return Response.json({ deleted: id });
}
