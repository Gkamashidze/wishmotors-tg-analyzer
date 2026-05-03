# Git / GitHub Fixes — Copy-Paste Ready

---

## Fix #1 — GitHub branch protection (terminal)

```bash
# GitHub CLI — enable branch protection on main
gh api repos/:owner/:repo/branches/main/protection \
  --method PUT \
  --field required_status_checks='{"strict":true,"contexts":["test"]}' \
  --field enforce_admins=false \
  --field required_pull_request_reviews=null \
  --field restrictions=null
```

---

## Fix #2 — Release tagging workflow

```bash
# After a stable milestone:
git tag -a v1.0.0 -m "First stable audit-clean release"
git push origin v1.0.0
```

---

## Fix #3 — Commit convention for debug work

```bash
# Debug endpoints/headers — always squash or revert before merge:
git revert <debug-commit-sha> --no-edit
git push origin main
```
