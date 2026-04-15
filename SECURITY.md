# Security Policy

## Supported Versions

The following versions of NyroForge EC2 Workstation Manager currently receive security fixes:

| Version | Supported |
|---------|-----------|
| 1.0.x (latest) | Yes |
| < 1.0.0 | No |

Only the most recent minor release is actively maintained. Upgrade to the latest version before reporting a vulnerability.

---

## Reporting a Vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.** Disclosing a vulnerability publicly before a fix is available puts all users at risk.

Instead, report vulnerabilities by email:

**matt@hersongo.com**

Include as much of the following information as possible to help us triage and reproduce the issue quickly:

- A clear description of the vulnerability and its potential impact
- The component or file(s) affected (e.g. a Lambda function, CDK stack, API endpoint)
- Step-by-step instructions to reproduce the issue
- Any proof-of-concept code or screenshots (attach files rather than embedding credentials)
- The AWS region and deployment version where you observed the issue, if applicable

Encrypt sensitive reports using PGP if you have a key on file; otherwise plain email is acceptable.

---

## Response Timeline

| Milestone | Target |
|-----------|--------|
| Acknowledgement of your report | Within 48 hours |
| Initial triage and severity assessment | Within 5 business days |
| Fix released for **Critical** (CVSS 9.0+) vulnerabilities | Within 30 days |
| Fix released for **High** (CVSS 7.0–8.9) vulnerabilities | Within 60 days |
| Fix released for **Medium/Low** vulnerabilities | Best effort; typically next minor release |

We will keep you informed of progress at each milestone. If you do not receive an acknowledgement within 48 hours, follow up by replying to your original email.

---

## Responsible Disclosure

We follow a coordinated disclosure model:

1. You report the issue privately to matt@hersongo.com.
2. We acknowledge receipt and begin investigation.
3. We develop and test a fix, keeping you informed of progress.
4. We release the fix and publish a security advisory.
5. You are credited in the advisory (unless you prefer to remain anonymous).

We ask that you:
- Allow us a reasonable time to fix the issue before publishing details publicly.
- Avoid accessing, modifying, or deleting data belonging to other users during your research.
- Limit testing to accounts and AWS environments you own or have explicit permission to test.

We commit to:
- Not pursue legal action against researchers who follow this policy in good faith.
- Respond promptly and keep you informed throughout the process.
- Credit researchers who help us improve security.

---

## Scope

The following are in scope for security reports:

- API Gateway endpoints and Lambda authorizer logic
- Cognito authentication and authorization flows
- IAM permission boundaries and privilege escalation paths
- Data exposure via DynamoDB, Secrets Manager, or SSM Parameter Store
- CDK/CloudFormation infrastructure misconfigurations with security impact
- XSS, CSRF, or injection vulnerabilities in the Next.js frontend

The following are out of scope:

- Vulnerabilities in AWS managed services themselves (report those to AWS)
- Issues only reproducible with physical access to a host
- Denial-of-service attacks that require a large number of authenticated requests
- Social engineering of project maintainers

---

## Security Best Practices for Deployers

If you are deploying this project in your own AWS account, we recommend:

- Enable AWS CloudTrail in all regions.
- Enable AWS Config to detect configuration drift.
- Rotate Cognito admin credentials periodically.
- Store domain join credentials exclusively in AWS Secrets Manager — never in SSM plaintext parameters.
- Enable MFA for all Cognito users, especially admins.
- Restrict the `workstation-admin` Cognito group to the minimum number of users.
- Review security group rules regularly and remove any rules with `0.0.0.0/0` source that are not strictly required.
- Do not commit `.env` files or AWS credentials to source control.

---

Website: [nyroforge.com](https://nyroforge.com)
Owner: Matt Herson
