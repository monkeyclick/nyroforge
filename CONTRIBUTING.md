# Contributing to NyroForge EC2 Workstation Manager

Thank you for your interest in contributing to this project. The following guidelines help keep the codebase consistent and the review process smooth.

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Local Setup](#local-setup)
- [Running Tests](#running-tests)
- [Branch Naming](#branch-naming)
- [Pull Request Process](#pull-request-process)
- [Code Style](#code-style)
- [Security Rules](#security-rules)

---

## Prerequisites

Before you begin, make sure the following tools are installed and configured:

| Tool | Minimum Version | Install |
|------|----------------|---------|
| Node.js | 18.x | https://nodejs.org/ |
| npm | 9.x (bundled with Node 18) | — |
| AWS CLI | 2.x | https://aws.amazon.com/cli/ |
| AWS CDK | 2.117.0+ | `npm install -g aws-cdk` |
| Git | Any recent version | https://git-scm.com/ |

You also need an AWS account with credentials configured (`aws configure`) and sufficient IAM permissions to deploy CloudFormation stacks, create Lambda functions, and manage Cognito resources.

---

## Local Setup

```bash
# 1. Fork the repository on GitHub, then clone your fork
git clone https://github.com/<your-username>/nyroforge.git
cd nyroforge

# 2. Install root dependencies
npm install

# 3. Install Lambda function dependencies
cd src/lambda/cognito-admin-service
npm install
cd ../../..

# 4. Install frontend dependencies
cd frontend
npm install
cd ..

# 5. Build TypeScript
npm run build

# 6. Verify CDK synthesises without errors
cdk synth
```

The project uses TypeScript throughout. Lambda source files live under `src/lambda/`, CDK infrastructure stacks are in `lib/`, and the Next.js frontend is in `frontend/`.

---

## Running Tests

### Unit tests

```bash
npm test
```

Jest is configured at the root. Tests live alongside source files or in the `tests/` directory.

### Watch mode (during development)

```bash
npm run test:watch
```

### Lint and format checks

```bash
# Check for lint errors
npm run lint

# Check formatting
npx prettier --check .
```

All of the above must pass before a pull request can be merged.

---

## Branch Naming

Use the following prefixes when creating branches:

| Prefix | When to use |
|--------|-------------|
| `feature/` | New functionality (e.g. `feature/spot-instance-support`) |
| `fix/` | Bug fixes (e.g. `fix/sg-rule-deletion-error`) |
| `docs/` | Documentation only changes (e.g. `docs/deployment-guide`) |
| `chore/` | Tooling, dependencies, CI (e.g. `chore/upgrade-cdk-2-120`) |
| `refactor/` | Code restructuring with no behaviour change |

Branch names should be lowercase and use hyphens, not underscores.

---

## Pull Request Process

1. **Keep PRs focused.** One logical change per pull request. Large PRs are harder to review and slower to merge.

2. **Base your branch on `main`** and keep it up to date with `git rebase origin/main` before opening a PR.

3. **Write a clear description.** Explain *what* changed and *why*, not just *how*. Link to any related GitHub issues.

4. **Ensure all checks pass.** Your PR must have:
   - `npm test` passing with no failures
   - `npm run lint` passing with no errors
   - `cdk synth` completing without errors

5. **Request a review.** At least one approval from a project maintainer is required before merging.

6. **Do not merge your own PR** unless you are the sole maintainer and have waited a reasonable review period.

7. **Squash commits** before merging if the branch contains many small work-in-progress commits. The final commit message should clearly describe the change.

---

## Code Style

This project uses **ESLint** and **Prettier**, both of which are already configured.

- ESLint configuration: `.eslintrc*` at the project root
- Prettier configuration: `.prettierrc*` at the project root

To auto-format your code before committing:

```bash
npm run format
```

To check for lint issues:

```bash
npm run lint
```

Key conventions:
- TypeScript strict mode is enabled — do not use `any` without a comment explaining why.
- Prefer `const` over `let`; avoid `var`.
- Lambda handler functions must validate all inputs before processing.
- AWS SDK calls must handle errors explicitly; do not let exceptions propagate silently.
- Keep Lambda functions small and focused on a single responsibility.

---

## Security Rules

**These rules are mandatory. Violations will result in a PR being closed.**

1. **Never commit `.env` files.** Use AWS Secrets Manager or SSM Parameter Store for secrets. The `.gitignore` already excludes `.env`, but double-check before pushing.

2. **Never commit AWS credentials.** This includes access keys, secret keys, session tokens, and any file that contains them (e.g. `~/.aws/credentials` excerpts pasted into config files).

3. **Never hardcode passwords, API keys, or tokens** in source files, CloudFormation templates, or CDK stacks. Pass them via environment variables backed by Secrets Manager.

4. **Do not disable security controls** (WAF rules, security group restrictions, Cognito MFA requirements) in PRs without explicit maintainer approval and a written justification.

5. **Report security vulnerabilities privately.** See [SECURITY.md](SECURITY.md) for the responsible disclosure process. Do not open a public GitHub issue for a security bug.

---

For questions about contributing, open a discussion on GitHub or contact the maintainer at [nyroforge.com](https://nyroforge.com).
