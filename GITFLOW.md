# Git workflow for this project

Use this workflow for **all** future commits and pushes.

## Standard flow for a new feature

1. **Create a feature branch** from `main`:
   ```bash
   git checkout main
   git pull origin main --rebase   # optional: get latest main first
   git checkout -b feat/<short-description>
   ```
   Branch naming: `feat/<what-you-did>` (e.g. `feat/what-i-did`, `feat/streaming`, `feat/new-chat-button`).

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

3. **Commit** with a conventional message:
   ```bash
   git add -A
   git commit -m "feat:<shortdescription>"
   ```
   Examples: `feat:whatidid`, `feat:streaming`, `fix:static-404`.

4. **Push** and create a pull request over `main`:
   ```bash
   git push -u origin feat/<short-description>
   ```
   Then open a **Pull Request** on GitHub/GitLab:
   - **Base:** `main`
   - **Compare:** `feat/<short-description>`
   - Or use CLI: `gh pr create --base main --head feat/<short-description> --title "feat: <shortdescription>"`

## Summary checklist

- [ ] Branch from `main`: `feat/<description>`
- [ ] `git pull origin main --rebase` before committing (if remote has changes)
- [ ] Commit message: `feat:<shortdescription>` (or `fix:`, `chore:` as needed)
- [ ] Push: `git push -u origin feat/<description>`
- [ ] Create PR: base `main`, head `feat/<description>`

## Notes

- Use **rebase** (not merge) when pulling from `main` to keep history linear.
- Prefer **conventional commit** prefixes: `feat:`, `fix:`, `chore:`, `docs:`.
