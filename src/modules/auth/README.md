# Auth

Accounts with an email and a password, and a cookie that keeps the browser signed in. No email verification (an address is not proven to be the person's), and no library: it is a few small files.

## The boundary

| Door | Who uses it | What it gives |
|---|---|---|
| [`index.ts`](index.ts) (server) | server components, server actions, API routes | `requireUser`, `getCurrentUser`, `startSession`, `endSession`, `createAccount`, `checkCredentials`, `getDefaultUser`, `claimAccount` |
| [`client.ts`](client.ts) (browser, and `src/proxy.ts`) | the forms, the proxy | the cookie's name and the password length rules |

## How it works

- **Password**: stored as an scrypt hash with its own salt and cost (`password.ts`). Text is Unicode-normalised first, so the same password typed on another keyboard still matches.
- **Session**: a random token in an httpOnly, SameSite=Lax cookie (`secure` when the request came in over HTTPS). The database keeps only the SHA-256 of the token (`sessions` table), so a leaked table can't sign anyone in. A session lasts 30 days; expired ones are cleaned up when someone signs in.
- **Checking**: `src/proxy.ts` only looks for the cookie (no database) and sends visitors without one to `/login`. The real check is `requireUser()`, called first in every server action and every component that loads user data. A stale or forged cookie fails there and is sent to `/login`.
- **Login errors** never say whether the email or the password was wrong, and a wrong email takes as long as a wrong password.
- **The API routes and the scripts** have no browser, so they act for `getDefaultUser()`: the account whose email is `INGEST_USER_EMAIL`, or the oldest account if that is unset. The routes still need `INGEST_API_KEY`.

## Claiming the original demo data

Before accounts there was one hard-coded user, `demo@replenish.local`, who owns everything saved so far. `npm run claim-demo -- you@example.com` asks for a password (typed hidden) and gives that row your email and password, so nothing is copied or moved. Run it once.

## Not done

- No rate limiting on login, no password reset, no change-password page, no "sign out everywhere".
- Anyone can sign up (there is no invite or allow-list), and an address isn't verified. Email-order ingestion will need a proof of address before it trusts one.
