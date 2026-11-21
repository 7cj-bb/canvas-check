# Host your own AI backend

The repository contains the extension and Cloudflare Worker source. The published beta ZIP is already connected to the project backend. These steps are for developers deploying their own copy.

1. Run `npm ci` and `npx wrangler login`.
2. Edit `cloud/wrangler.jsonc` with your own Worker name. The file deliberately omits the original account ID. Choose the appropriate account during deployment.
3. Set your own OpenAI key with `npx wrangler secret put OPENAI_API_KEY --config cloud/wrangler.jsonc`.
4. Create an independent random client token of at least 32 URL-safe characters and store it with `npx wrangler secret put CLIENT_TOKEN --config cloud/wrangler.jsonc`. Never use an OpenAI key as the client token.
5. Deploy with `npx wrangler deploy --config cloud/wrangler.jsonc`. Keep the rate limiter and Durable Object bindings/migration: they enforce a global AI usage budget and fail closed when unavailable.
6. Set `CANVAS_CHECK_API_URL` to your HTTPS Worker origin and `CANVAS_CHECK_CLIENT_TOKEN` to your separate client token, then run `npm run build`.
7. Load `dist/` as an unpacked extension. The included public extension identity fixes its ID to the distribution ID already listed in the example Worker configuration.

If you use a different extension identity or later receive a Chrome Web Store ID, update the Worker allowlist accordingly. The public key in `cloud/extension-identity.json` is an extension identifier, not a signing private key.

Use your shell's normal environment-variable mechanism for build variables; do not commit credentials or output builds. `.gitignore` excludes `dist*/`, `.env*`, `.dev.vars*`, `.wrangler/`, and `.local-private/`. A shared client token is visible in a distributed extension and is not user authentication. Larger deployments need user accounts and per-user quotas.

Default AI models are configured in `cloud/wrangler.jsonc`. Model calls may incur charges on the backend owner's account. The global usage budget limits weighted requests, not an exact dollar amount.
