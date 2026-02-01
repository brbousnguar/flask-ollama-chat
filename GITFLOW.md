# Git workflow for this project

Use this workflow for **all** future commits and pushes.

## Standard flow for a new feature

1. **Create a feature branch** from `main`:
   ```bash
   git checkout main
   git pull origin main --rebase   # optional: get latest main first
   git checkout -b feat/<short-description>
   ```
   **Branch naming:** use `feat/[what-you-did-in-the-feature]` — replace with the actual feature, e.g. you added a new chat button → `feat/add-new-chat-button`; you added streaming → `feat/streaming-response`. Do **not** use a literal name like `feat/what-i-did`.

2. **Pull rebase** (keep your branch up to date with `main`):
   ```bash
   git pull origin main --rebase
   ```
   If you have uncommitted changes, stash first:
   ```bash
   git stash push -m "WIP"
   git pull origin main --rebase
   git stash pop
   ```

3. **Commit** with a conventional message that **describes what you did** (not a placeholder):
   ```bash
   git add -A
   git commit -m "feat:<actual-feature-description>"
   ```
   Examples: `feat:add-new-chat-button`, `feat:streaming-response`, `fix:static-files-404`, `chore:add-gitflow-docs`.
   Do **not** use literal placeholders like `feat:whatidid`; use the real feature name.

4. **Push** and create a pull request over `main`:
   ```bash
   git push -u origin feat/<short-description>
   ```
   Then open a **Pull Request** on GitHub/GitLab:
   - **Base:** `main`
   - **Compare:** `feat/<short-description>`
   - Or use CLI: `gh pr create --base main --head feat/<short-description> --title "feat: <actual-feature-description>"`

## Summary checklist

- [ ] Branch from `main`: `feat/[what-you-did]` (e.g. `feat/add-new-chat-button`)
- [ ] `git pull origin main --rebase` before committing (if remote has changes)
- [ ] Commit message: `feat:<actual-feature-description>` (e.g. `feat:add-new-chat-button`; or `fix:`, `chore:` as needed)
- [ ] Push: `git push -u origin feat/<your-feature-name>`
- [ ] Create PR: base `main`, head `feat/<your-feature-name>`

## Ensure `main` exists on remote

If the remote has no branches yet (e.g. new repo), push `main` first so PRs have a base branch:

```bash
git checkout main
git push -u origin main
```

Then push your feature branch and create the PR.

## Default branch: `main`

On GitHub, the **default branch** should be `main` (not a feature branch). If it isn’t:

- **GitHub CLI:** `gh repo edit --default-branch main`
- **GitHub UI:** Repo → Settings → General → Default branch → switch to `main` → Update

## Notes

- Use **rebase** (not merge) when pulling from `main` to keep history linear.
- Prefer **conventional commit** prefixes: `feat:`, `fix:`, `chore:`, `docs:`.
- Commit message must describe the **actual change** (e.g. `feat:add-new-chat-button`), not a placeholder.
- Branch name must be **feat/[what-you-did]** (e.g. `feat/add-new-chat-button`), not a literal like `feat/what-i-did`.
