import { createHash } from "node:crypto";

/**
 * Short one-way fingerprint of a login secret, safe to carry inside a signed
 * session cookie.
 *
 * Sessions used to only store `{authed: true}` — changing ADMIN_PASSWORD or
 * OPERATOR_PASSWORD in Vercel had zero effect on cookies already issued, so
 * the only real way to revoke a live session was rotating SESSION_SECRET /
 * OPERATOR_SESSION_SECRET (undocumented, and it logs out every admin at
 * once). Stamping the fingerprint of the password in effect at login time
 * and comparing it on every check makes a password change do what an admin
 * expects: it invalidates sessions issued under the old password, without
 * touching anyone else's.
 */
export function passwordFingerprint(secret: string | undefined): string {
  return createHash("sha256")
    .update(secret ?? "")
    .digest("hex")
    .slice(0, 16);
}
