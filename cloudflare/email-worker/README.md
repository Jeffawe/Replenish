# Email Worker

Cloudflare Email Routing sends every email for the domain to this Worker; the Worker posts the sender, subject and text to the app (`/api/email/inbound`). The app does the rest. See [docs/ingestion.md](../../docs/ingestion.md).

## Deploy (once)

1. `cd cloudflare/email-worker && npm install`
2. `npx wrangler login`
3. Set the secret to the same value as `EMAIL_WORKER_SECRET` in the app's `.env.local` (and on the server that runs the app):
   `npx wrangler secret put EMAIL_WORKER_SECRET`
4. Check `APP_URL` in `wrangler.toml`, then `npx wrangler deploy`.

## Point the domain at it

Cloudflare dashboard, your domain, **Email → Email Routing**:

1. Enable Email Routing (accept the MX and SPF records it adds). To use a subdomain (`replenish.jeffawe.dev`), add it under Settings → Subdomains.
2. **Routing rules → Catch-all address → Send to a Worker → `replenish-email`**, and turn the rule on.

The app needs `EMAIL_DOMAIN` set to the address's domain (for example `replenish.jeffawe.dev`) and `EMAIL_WORKER_SECRET`.

## Try it without Gmail

Send an email from any account to the address shown on the app's **Email orders** page. It will show in "What we received" as skipped ("Not from a store we read").
