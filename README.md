# 4865sj.github.io

## Supabase setup

Board and leaderboard changes are activated by running `supabase-schema.sql`
in the linked Supabase project's SQL Editor. The Board moderation allowlist is
server-side; its current sole moderator is the verified Google account
`4865sj@gmail.com`.

## Supabase availability

The `Supabase availability` GitHub Actions workflow reads at most one public
Board ID every six hours (03:17, 09:17, 15:17 and 21:17 Korea time). It reuses
the publishable key from `board.js`, performs no database writes, and prints
neither the key nor query results. No admin key or additional secret is needed.
Transient failures are retried; persistent failures make the workflow fail.

After this workflow is pushed to `main`, it runs once immediately. Later runs
are scheduled on the default branch. To check manually, open **Actions →
Supabase availability → Run workflow**. GitHub Actions notification delivery
depends on your GitHub notification settings.

This helps prevent low-activity pausing on the Supabase Free plan but is not an
uptime guarantee. In particular:

- GitHub disables scheduled workflows in public repositories after 60 days
  without repository activity. Check the Actions page during long breaks and
  re-enable the workflow if disabled; successful scheduled runs alone do not
  remove this limitation.
- A paused Supabase project must be resumed from its dashboard before the
  check can succeed. This workflow cannot restore a paused project.
- Supabase Pro removes inactivity pausing if unattended availability is needed.
  This workflow does not change the project's plan or billing.

References: [Supabase project pausing](https://supabase.com/docs/guides/platform/free-project-pausing)
and [GitHub scheduled workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).
