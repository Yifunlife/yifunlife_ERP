export async function POST() {
  return Response.json({ error: "请联系管理员或 CEO 创建账号。" }, { status: 403 });
}
