# Contributing

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
