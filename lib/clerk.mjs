// lib/clerk.mjs — verify Clerk session JWTs server-side without a secret key,
// using the instance's public JWKS. Requires env CLERK_ISSUER, e.g.
//   CLERK_ISSUER=https://wanted-marmoset-80.clerk.accounts.dev
// Returns the Clerk user id (sub) or null — callers treat null as "anonymous".

import { createRemoteJWKSet, jwtVerify } from 'jose';

let jwks = null;

export async function userFromReq(req) {
  try {
    const iss = process.env.CLERK_ISSUER;
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : null;
    if (!token || !iss) return null;
    jwks ||= createRemoteJWKSet(new URL(iss.replace(/\/$/, '') + '/.well-known/jwks.json'));
    const { payload } = await jwtVerify(token, jwks, { issuer: iss.replace(/\/$/, '') });
    return payload.sub || null;
  } catch {
    return null;
  }
}
