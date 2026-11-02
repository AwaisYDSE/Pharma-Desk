# How to publish an update (no coding needed)

**To publish what is already on GitHub**
1. Open your repository on GitHub and click **Actions**.
2. On the left click **Publish an update**, then **Run workflow** on the right.
3. Choose **optional** or **must** and write what is new.
4. Press the green **Run workflow** button.

It takes about 20 minutes. GitHub tests everything first. If a test fails, nothing goes live and shops keep the old version.

- **Optional:** users see a bar with Update now and Later.
- **Must:** users see only Update now until they update.

Use **must** only for serious fixes, because it stops every shop until it updates.

**To add a fix or a new feature**, someone has to change the code first. You don't need to learn this. Give a developer, or a new Claude Code session with this repository, what you want and these rules:
- Work on a new branch, never directly on main.
- Run `npm run build` and `npm test` before merging. Everything must pass.
- Never change the public key in `shared/vendor.ts`, because every licence key would stop working.
- Add database changes carefully, because real shops have real data.
- Every new sentence needs Urdu, Arabic, Hindi and Spanish.

When their work is merged into main, it goes live by itself as the same version number. Then use the steps above so shops are told to update.

**The vendor dashboard** is separate. If `vendor/worker.js` changes, it must be pasted into Cloudflare again. See the top of that file.
