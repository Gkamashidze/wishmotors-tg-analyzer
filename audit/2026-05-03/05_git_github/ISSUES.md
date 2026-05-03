# Git / GitHub Issues — Audit 2026-05-03

---

## პრობლემა #1 — Bus factor = 1
- 📍 ფაილი: git history (332 commits Giorgi, 12 Claude)
- 🟡 სიმძიმე: High (organizational risk)
- ❌ პრობლემა: ერთი human contributor. პროექტი single point of human failure-ია. CLAUDE.md-ი კარგი documentation-ია, მაგრამ onboarding time 6-8 სთ.
- ✅ გამოსწორება: README გაუმჯობესება, onboarding დოკუმენტი, local dev workflow.
- ⏱ სავარაუდო დრო: N/A (organizational)

---

## პრობლემა #2 — debug commits in main
- 📍 ფაილი: `git log` — SHA `912a3d1`, `97e0f50`
- 🟢 სიმძიმე: Low
- ❌ პრობლემა: `debug: add /api/debug/drive-config endpoint` და `debug: add X-WM-Build header` production history-ში. Debug commits should be reverted before ship.
- ✅ გამოსწორება: future — `debug:` commits revert before merge; security fix #1 resolves the endpoint issue.
- ⏱ სავარაუდო დრო: included in security fix #1

---

## პრობლემა #3 — No GitHub branch protection
- 📍 ფაილი: GitHub repository settings
- 🟢 სიმძიმე: Low
- ❌ პრობლემა: Required status checks not enforced. Broken push can deploy to Railway before CI finishes.
- ✅ გამოსწორება: GitHub Settings → Branches → Require status checks before merging.
- ⏱ სავარაუდო დრო: 30 წთ

---

## პრობლემა #4 — No release tagging
- 📍 ფაილი: git tags (none)
- 🟢 სიმძიმე: Low
- ❌ პრობლემა: Rollback requires knowing commit SHA rather than a named version. `git tag v1.2.3` convention absent.
- ✅ გამოსწორება: after each milestone — `git tag v<major>.<minor>.<patch>`
- ⏱ სავარაუდო დრო: 15 წთ/release
