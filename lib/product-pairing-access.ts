export function canManageProductPairing(user: { role?: string; username?: string; name?: string } | null | undefined) {
  return user?.role === "admin" || (
    user?.role === "employee" && user.username === "yw052" && user.name === "葛晶玉"
  );
}
