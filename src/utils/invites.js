// Single-use admin invite links.
// The raw token goes out once (in the link); only its SHA-256 hash is stored,
// so a leaked database can't be used to accept an invite.
import crypto from 'crypto';
import { hashToken } from './tokens.js';

export const INVITE_TTL_DAYS = Number(process.env.INVITE_TTL_DAYS || 7);

export const inviteStatus = (inv, now = new Date()) => {
   if (!inv) return 'none';
   if (inv.usedAt) return 'used';
   if (inv.revokedAt) return 'revoked';
   if (inv.expiresAt <= now) return 'expired';
   return 'pending';
};

// Revokes any open invites for the organization and issues a new one.
// Pass a Prisma client or transaction client. Returns { token, invite }.
export async function issueInvite(db, { organizationId, email, name = null, role = 1, createdById = null }) {
   const now = new Date();
   await db.invite.updateMany({
      where: { organizationId, usedAt: null, revokedAt: null },
      data: { revokedAt: now },
   });
   const token = crypto.randomBytes(32).toString('base64url');
   const invite = await db.invite.create({
      data: {
         organizationId,
         email: email.toLowerCase(),
         name,
         role,
         tokenHash: hashToken(token),
         expiresAt: new Date(now.getTime() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000),
         createdById,
      },
   });
   return { token, invite };
}

export const publicInvite = (inv) => ({
   id: inv.id,
   email: inv.email,
   status: inviteStatus(inv),
   expiresAt: inv.expiresAt,
   usedAt: inv.usedAt,
   createdAt: inv.createdAt,
});
