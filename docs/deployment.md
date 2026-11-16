# Vercel deployment

Deploy the web app as a Next.js project with `web` as its Root Directory.
The Git integration deploys branch previews and updates production from `main`.

## Configure environments

1. Import the GitHub repository in Vercel. Set the Root Directory to `web`,
   the framework to Next.js, the package manager to npm, and the production branch to `main`.
2. Keep Preview and Production environment variables separate. Use a disposable staging
   Supabase project for previews and a separate project for production.
3. Keep `SUPABASE_SERVICE_ROLE_KEY` server-side. Never give a preview credentials
   that can access production data.
4. Choose deployment protection according to the data and intended audience. Public
   deployments can be opened by anyone with the URL; protected ones require access.

See [Vercel's Git integration](https://vercel.com/docs/git) and
[deployment protection](https://vercel.com/docs/deployment-protection).
For the separate inference service, see [embedding service](embedding-service.md).

## Verify a preview

Open the branch preview on two phones and check the page layout and content.
Confirm collaborators can access protected previews and that a merge updates production.
Test staging isolation with synthetic data before connecting real accounts or content.

The **Vercel Preview Smoke** GitHub Actions workflow checks the fictional landing page.
Run it from the Actions tab with the HTTPS preview URL; the workflow must exist on the
default branch before GitHub can run it manually.

For a protected preview, store the automation bypass token in the GitHub Actions secret
`VERCEL_AUTOMATION_BYPASS_SECRET`. Set `VERCEL_ALLOWED_PREVIEW_HOST` to the exact
preview hostname, without a scheme; update it when checking a different hostname.

The smoke test sends the token only to the allowed host and does not follow redirects.
It checks reachability, not phone layout or database isolation. See
[Vercel's automation bypass guide](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection).

## Roll back

If a preview fails, fix the branch and push a new commit. If production breaks, revert
the change or redeploy the last known-good deployment, then check the page and logs.
Do not connect a preview to production data to debug a deployment.
