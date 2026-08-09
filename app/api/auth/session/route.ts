import { getLoginSession } from "../../../../lib/auth";

export async function GET(request: Request) {
  const session = await getLoginSession(request); if (!session) return Response.json({ authenticated: false });
  return Response.json({ authenticated: true, username: session.username, expiresAt: session.expiresAt });
}
