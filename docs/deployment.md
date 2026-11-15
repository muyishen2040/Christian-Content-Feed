# Vercel deployment, protection and rollback (MUY-14)

This repository is a monorepo. **Vercel project Root Directory must be `web`**, framework `Next.js`. The project Git integration (not merely this PR) must be configured in Vercel. The checked-in `web/vercel.json` adds basic response headers, and the manual workflow verifies an actual preview URL. No real Vercel project or credentials are created by this PR.

## Connect repository and create staging/production scopes

1. In Vercel, import `muyishen2040/Christian-Content-Feed` from GitHub, selecting the intended team/personal account. Under Project Settings > Build and Deployment set Root Directory `web` (not the repo root), Next.js framework and npm. Confirm `main` as Production Branch.
2. Under Environment Variables configure **Preview** and **Production** scopes separately. For Preview use only a *disposable staging Supabase* `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. `SUPABASE_SERVICE_ROLE_KEY`, if needed in future, must remain a server-only secret and must not have a `NEXT_PUBLIC_` prefix. Production points only to a separate pilot project, with no real users until launch. A preview must never have credentials that can access the production/pilot database.
3. Configure GitHub PR previews and verify that a commit on a branch yields a unique HTTPS preview, while merge to `main` updates the production deployment. Keep public production access restricted until the pilot is approved.
4. In Settings > Deployment Protection, protect previews with the method supported by your Vercel plan. **On Vercel Hobby, Preview protection does not protect the production domain.** Do not place personal descriptions or unapproved testimony behind a publicly accessible production URL. If the plan cannot protect production, keep testing limited to protected previews and delay the pilot production launch (or add properly tested application-level authorization / upgrade the plan). Prefer Vercel Authentication or restricted shareable links for collaborator phone tests.
5. Invite Mu An to the Vercel project or use a controlled Shareable Link. From two physical phones, open the preview and confirm narrow-screen wrapping, mock content notice, and safe login/protection. Do not share screenshots containing personal descriptions.

## CI and on-phone smoke verification

After creating a real Vercel Preview deployment:
- Once this workflow exists on the default branch, open GitHub Actions > **Vercel Preview Smoke** > Run workflow and paste the HTTPS preview URL. GitHub only exposes manual workflows for dispatch when the workflow file exists on the default branch. Until then, verify the preview through Vercel and on phones. The action expects the existing fictional home page text and fails on an authentication wall or wrong build.
- When Deployment Protection is enabled, generate a *Protection Bypass for Automation* token in Vercel and store it as GitHub Actions secret `VERCEL_AUTOMATION_BYPASS_SECRET` (never commit or print it). **Also set GitHub Actions variable `VERCEL_ALLOWED_PREVIEW_HOST` to the **exact hostname for the preview being checked**, e.g. `christian-content-feed-git-feature-yourteam.vercel.app` (no scheme). Update this repository variable for each different preview before running the workflow. The smoke test refuses to transmit the bypass token to any other host or follow HTTP redirects.
- Test staging isolation: create a synthetic anonymous session/record in the disposable staging project, verify it cannot select/modify the corresponding production account/table. If real production credentials have not been provisioned, record **blocked** rather than claiming the isolation test passed.
- Confirm the selected plan permits both collaborators to view the preview, whether with invited members or a shareable preview link.

`web/scripts/verify-preview.mjs` and its unit tests contain no real credentials. It only validates reachability of the existing mock landing page; it does **not** replace physical phone and database isolation testing.

## Rollback

- If a preview fails, fix the branch and push a new commit; use the preview URL on the PR to retest.
- If a merge to `main` breaks production, revert the offending PR on GitHub and let the Git integration redeploy. Alternatively redeploy the last known-good Vercel deployment while the revert is reviewed.
- After rollback, confirm the protected page on both a phone and in the deployment logs. Never temporarily point a preview to production data to debug.

## Release gate

MUY-14 is **not Done** until a real test PR generates a reachable phone preview, a merge demonstrably updates the target deployment, preview/production Supabase isolation is tested, both collaborators can access previews, and rollback instructions are reviewed.

Official docs: https://vercel.com/docs/git and https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection
