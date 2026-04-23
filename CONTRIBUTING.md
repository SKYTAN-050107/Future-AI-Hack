# Contributing

Thanks for contributing to AcreZen / PadiGuard AI. This project combines a React PWA, Python backends, Firebase services, and Google AI workflows, so small, well-scoped changes are the easiest to review and merge.

By contributing, you agree that your contributions will be licensed under the Apache License 2.0 used by this repository.

## How To Contribute

1. Fork or create a feature branch from the latest main branch.
2. Keep changes focused on one feature, fix, or documentation improvement.
3. Test the part of the system you touched.
4. Open a pull request with a clear summary, setup notes, and screenshots if the UI changed.

## Development Setup

Install the main dependencies:

```bash
npm install
cd frontend && npm install
cd ../backend/cloud-functions && npm install
cd ../..
python3 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
```

Run the full local stack:

```bash
cd frontend
npm run dev:full
```

This starts the frontend, diagnosis backend, and swarm backend together.

## Code Guidelines

- Follow the existing naming and file structure of the module you are editing.
- Keep commits small and easy to review.
- Document any new environment variables in `README.md`.
- If you change agent flows, retrieval logic, or API contracts, update the relevant docs as part of the same PR.
- If you use AI coding assistance, review every generated change carefully and make sure you can explain it.

## Security Setup (Required)

This repository enforces secret scanning in two layers:

1. **Local pre-commit hook** (blocks suspicious secrets before commit)
2. **GitHub Actions scan** (blocks leaked secrets in push/PR CI)

### One-time local setup

From repository root:

```bash
./scripts/setup-git-hooks.sh
```

Expected output:

```text
[hooks] core.hooksPath set to .githooks
```

### Verify hooks path

```bash
git config core.hooksPath
```

Expected value:

```text
.githooks
```

### If commit is blocked by secret scan

1. Remove sensitive files from index (without deleting local file):

```bash
git rm --cached <path>
```

2. Replace secrets with environment variables/placeholders.
3. Rotate any credential that may have been exposed.
4. Commit again.

## Notes

- Do not commit `.env` files, private keys, or service account credentials.
- Keep real credentials in local environment files and secret managers only.
- Do not commit generated secrets inside `.gcloud/`, service account JSON files, or copied cloud credentials.
- For UI changes, include screenshots or a short demo clip when possible.
- For backend changes, mention the affected routes, agents, or services in the PR description.
