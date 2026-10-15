# Optional transactional email

Scaleway TEM handles account confirmation and password recovery. Delivery uses
the TEM HTTPS API, so no SMTP daemon or additional dependency is required.

## Configuration

1. In Scaleway, verify a sending domain and complete its required DNS records.
2. Create an IAM application/API secret key with TEM sending permission for the
   project containing that domain. See the [Scaleway setup guide](https://www.scaleway.com/en/docs/transactional-email/how-to/generate-api-keys-for-tem-with-iam/).
3. Copy the variables from `deploy/transactional-email.env.example` into your
   server environment or secret manager:

   | Variable | Value |
   | --- | --- |
   | `PRISMATICA_TEM_PROJECT_ID` | Scaleway project UUID containing the verified domain |
   | `PRISMATICA_TEM_API_KEY` | Secret API key with permission to send through TEM |
   | `PRISMATICA_TEM_REGION` | TEM region, default `fr-par` |
   | `PRISMATICA_EMAIL_FROM` | Sender email address on the verified domain |
   | `PRISMATICA_PUBLIC_URL` | Canonical website HTTPS origin, e.g. `https://prismatica.example.org` |

   The public URL must not include a path, query, or fragment. HTTP localhost is
   accepted only outside production. Links never use the incoming Host header.
   Keep the API key out of git, browser configuration, and `NEXT_PUBLIC_*` variables.
   For systemd deployments, use a protected `EnvironmentFile` in a service override.
4. Rebuild for this code update and restart the application. Subsequent changes to
   environment values require a restart; changing the website toggle does not.
5. Open **Administration → System Settings → Transactional Email**. Refresh the
   configuration status, then enable email. The check validates local configuration;
   it does not authenticate with Scaleway or prove domain verification/delivery.
6. Register a test account you control and confirm the email. Exercise Forgot
   password and check the TEM console for delivery status. API acceptance does not
   guarantee inbox delivery. Disable provider open/click tracking for these emails.

Email defaults to **disabled**, including for existing installations. Only an
administrator can change `authSettings.transactionalEmailEnabled`; credentials
are never persisted in website settings or returned to the browser. The switch
can always be turned off, even if credentials have been removed.

## Behaviour

| Feature | Disabled | Enabled |
| --- | --- | --- |
| Public registration | Existing immediate sign-in flow | Confirmation required before sign-in |
| Existing/admin-created accounts | Sign in normally | Sign in normally; no retroactive confirmation |
| Password assistance | Administrator generates a temporary password | Email reset link, with administrator reset still available |
| Email request/link endpoints | Refuse the action without contacting TEM | Rate-limited email flows |

Public registration has its own independent switch. Confirmation/resets remain
available when public registration is closed. Turning email off also allows
pending accounts to sign in; re-enabling requires confirmation for accounts still
marked pending. Such accounts can request a fresh confirmation or reset link.

Failed confirmation delivery leaves the account pending, with a visible resend
instruction. The application does not silently grant access after a delivery
failure. Password-reset requests return the same message for unknown/ineligible
addresses and delivery errors. Provider details, recipients, credentials, and
bearer links are not logged by this integration. An unavailable-delivery event
is logged without personal data. Delivery is synchronous, with a 10-second
timeout; retries are user-initiated, with no application background queue.

## Link and session handling

- Random 256-bit tokens; only SHA-256 hashes are persisted.
- Confirmation expires after 24 hours; password reset after 30 minutes.
- Tokens are bound to their purpose and the current password hash. Successful
  redemption invalidates outstanding account links. Resends replace the previous
  link, with a persisted 60-second per-account/purpose cooldown.
- Email links carry tokens in the URL fragment, which is cleared after the page
  loads. Reloading then requires reopening the email. No confirmation happens on
  GET: the user must press Confirm, avoiding automatic email-scanner activation.
- Resetting a password invalidates existing sessions. Profile password changes
  invalidate other sessions and refresh the current one. Existing cookies remain
  valid until the account's session version changes.
- Account pages have no-index and no-referrer metadata. Templates have no tracking
  pixels and contain no review/project information.

State persists in both JSON and PostgreSQL modes. PostgreSQL adds
`auth_settings.transactional_email_enabled` and `app_users.email_auth` idempotently.
Legacy JSON-to-PostgreSQL sync and migration preserve these fields as well.

The application currently uses synchronous whole-state read/write operations and
an in-memory request limiter. Run one application writer process. Multiple
instances require transactional account mutations and a shared rate limiter
before relying on token single-use and throttling across instances.

## Verification

`npm run check:email` exercises disabled mode, configuration validation, mocked
TEM delivery/errors, registration, confirmation, expiry, resend, password recovery,
session invalidation, and persistence using isolated temporary state and a local
temporary PostgreSQL cluster. It never sends real email or uses the application
database. PostgreSQL tools (`pg_config`, `initdb`, `pg_ctl`) are required.
