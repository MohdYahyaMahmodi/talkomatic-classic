# Terms & Conditions for Bot Developers

By creating, deploying, or operating bots on Talkomatic, you agree to the following terms.

---

## Responsible Usage

Bots must not harm, disrupt, or degrade the Talkomatic platform or the experience of its users. Specifically, you **must not**:

- Spam rooms with rapid, repetitive, or meaningless messages.
- Create or destroy rooms in rapid succession to consume server resources.
- Attempt to bypass rate limits, AFK detection, IP limits, or any other server-side protections.
- Exploit vulnerabilities, reverse-engineer security systems, or attempt unauthorized access to server internals or user data.
- Impersonate real users, moderators, or Talkomatic staff.
- Use bots to harass, threaten, or target other users.
- Deploy bots that post offensive, illegal, or harmful content.
- Use bots to collect, store, or exfiltrate personal information about other users.

## Rate Limits & Fair Use

- Always respect the documented rate limits. The server enforces 500 socket events per minute for bots, with additional per-action cooldowns.
- Do not attempt to circumvent rate limits by rotating tokens, IPs, or connections.
- Bots that exceed rate limits will be automatically throttled. Repeated violations will result in permanent token revocation and IP bans.
- If your bot requires higher limits for a legitimate use case, contact the Talkomatic team before deploying.

## Bot Token Responsibility

- Your bot token is your responsibility. Do not share it publicly, commit it to public repositories, or embed it in client-side code.
- Each IP address is limited to 3 active tokens. Do not create tokens you do not need.
- Tokens expire after 30 days. Plan for renewal in your bot's lifecycle.
- Talkomatic reserves the right to revoke any token at any time without notice.

## Developer Accountability

As the bot developer, you are fully responsible for all actions performed by your bot. This includes any messages it sends, rooms it creates, and interactions it has with other users. Ignorance of your bot's behavior is not a defense.

## Enforcement

Violations of these terms may result in any or all of the following, at Talkomatic's sole discretion:

- Immediate revocation of your bot token(s).
- Permanent banning of your IP address.
- Removal of any rooms or content created by your bot.
- Suspension or banning of associated user accounts.

Enforcement decisions are final.

## Changes to These Terms

These terms may be updated at any time. Continued use of the bot platform after changes are published constitutes acceptance of the updated terms. Check this page periodically.

---

> **When in doubt, ask.** If you are unsure whether a bot behavior is acceptable, reach out to the Talkomatic community (Discord or GitHub Discussions) before deploying.

By developing or operating bots on Talkomatic, you acknowledge and agree to these terms.
