import { getLoginSession } from "../../../../lib/auth";

export async function GET(request: Request) {
  const session = await getLoginSession(request); if (!session) return Response.json({ authenticated: false });
  return Response.json({ authenticated: true, email: session.email, name: session.name, role: session.role, expiresAt: session.expiresAt });
}
