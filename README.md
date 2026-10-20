# Qorlog AI

An agentic timesheet assistant. People keep their own timesheets (an uploaded Excel file or a Google Sheet), then fill them in by chatting, either in the web app or on Telegram.

- **Agents** read each timesheet, work out its structure (hours-only, task-based or mixed; row per day or per entry; tab per month), and then log time, mark leave (full or half day), edit past dates and export to Excel or PDF.
- **Daily reminder** at about 6 PM in each user's own timezone on Telegram. The reply fills the timesheet.
- **Channel-aware replies**: markdown (streamed) on the web, clean plain text on Telegram. WhatsApp can be added later through the same `Channel` abstraction.
- **Admin panel**: users and a model catalog. Admins have no access to timesheet content (see Security).

Stack: Next.js 16 (App Router), React 19, Tailwind v4 + shadcn-style components, Vercel AI SDK v7 with Groq, Neon Postgres + Drizzle, Auth.js v5, exceljs, pdf-lib, Google Sheets API.

The "Pydantic agent" idea maps to TypeScript: tools and structured outputs are defined with zod schemas, and the AI SDK validates every model output against them.

## Setup

```bash
npm install
cp .env.example .env.local        # then fill it in (below)
npm run db:push                   # creates tables in Neon (drizzle-kit push, no migration files)
npm run db:seed                   # seeds the Groq model catalog
npm run dev
```

### Environment

| Variable | How to get it |
|---|---|
| `DATABASE_URL` | Create a project at neon.tech and copy the connection string. |
| `AUTH_SECRET` | `openssl rand -base64 32` |
| `QORLOG_MASTER_KEY` | `openssl rand -base64 32`. **Back it up**: losing it makes all stored data unreadable. |
| `ADMIN_EMAILS` | Comma-separated emails that become admins on registration. |
| `GROQ_API_KEY` | console.groq.com (free tier). |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | See below. |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME` | From @BotFather. `TELEGRAM_WEBHOOK_SECRET` is optional. |
| `CRON_SECRET` | Any long random string. |
| `APP_URL` | Public URL, no trailing slash. Optional on Vercel (the production domain is used). |

### Google Sheets (how write access works)

Qorlog uses **one service account**, so users never hand over credentials or a key file.

1. In Google Cloud, create a project, enable the **Google Sheets API**, create a service account and download a JSON key.
2. Put the JSON (one line, or base64) in `GOOGLE_SERVICE_ACCOUNT_JSON`.
3. Users add a Google Sheet by link and are shown the service account's email (with a copy button). They click Share on their sheet and add that email as **Editor**. Qorlog checks access before saving and explains what to fix if it fails.

### Telegram (automatic)

1. Create a bot with @BotFather and set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_BOT_USERNAME` in Vercel.
2. Deploy. At the end of every production build, Qorlog registers the webhook and the command menu itself, using `APP_URL` (or Vercel's production domain if `APP_URL` is unset). Preview deploys leave the production webhook alone.
3. The webhook secret is derived from the bot token unless you set `TELEGRAM_WEBHOOK_SECRET`.
4. The reminder job also re-checks the webhook on each run and repairs it if the domain changed. `npm run telegram:setup` still exists for manual use.

Users can register by chatting with the bot (name, timezone, first timesheet), or link an existing web account from Settings.

### Reminders (needs a scheduler)

Vercel serverless functions don't stay running, so in-process schedulers like `node-cron` can't work there. Something external must call `GET /api/cron/reminders` every 30 minutes (30 because of half-hour zones such as IST) with `Authorization: Bearer $CRON_SECRET`.

- **Vercel Hobby (free):** it only allows daily crons, and a sub-daily one in `vercel.json` fails the deploy. Use the included GitHub Actions workflow (`.github/workflows/reminders.yml`): add repo secrets `APP_URL` and `CRON_SECRET`. GitHub may start a run several minutes late, which is fine because of the 3 hour send window.
- **Vercel Pro:** add `"crons": [{ "path": "/api/cron/reminders", "schedule": "*/30 * * * *" }]` to `vercel.json` and delete the workflow.
- Any other scheduler (cron-job.org, Upstash QStash) works the same way.

A reminder is sent when the user's local time is past their reminder time (default 18:00) and within a 3 hour window, once per local day, on weekdays unless they enable weekends. A failed send releases the claim so the next run retries.

## Security model

- **Per-user envelope encryption.** Each user has a random data key, wrapped by `QORLOG_MASTER_KEY` and stored in `users.wrapped_dek`. Timesheet files, Google links, analysis profiles and chat history are encrypted with AES-256-GCM using that key, bound to the user id as additional authenticated data. Ciphertext copied between users will not decrypt.
- **Every query is scoped by user id.** Agent tools are built per request with the user id closed over, so the model can never choose whose data it touches.
- **Admins see metadata only.** `lib/data/admin.ts` selects account fields and counts (timesheet count, Telegram linked, token totals). It never imports the vault, and an integration test asserts no ciphertext or content appears in its output. Admin actions are written to an audit log.
- **Auth.** Passwords use bcrypt; sessions are JWT. Telegram-to-web sign-in uses one-time codes stored as hashes. The link page consumes the code only on POST, so chat link previews cannot burn it.
- **Endpoints.** The Telegram webhook verifies the secret header in constant time and de-duplicates updates; cron requires the bearer secret; state-changing routes check same origin; exports are download-by-id and owner-only, and expire after 30 minutes.
- **Google formula injection**: cells starting with `= + - @` are written as text.

Honest limits:
- Whoever holds **both** the database and the server environment (including the master key) can decrypt. For stronger separation, give the admin panel its own restricted DB role limited to the non-content columns, and move the master key to a KMS.
- Timesheet snippets are sent to Groq to answer questions, so Groq's data terms apply.

## Tests

```bash
npm test
```

Unit tests cover crypto isolation, timezones, date parsing, channel formatting, sheet operations and exports. Integration tests run against an in-process Postgres (PGlite) with a scripted mock model and a stubbed Telegram API: registration flow, profiling fallback, tool calls, user isolation, single-use link codes, reminder timing and retries, and the admin data layer.

## Known limitations

- PDF export is Latin-1 only (non-Latin text is transliterated or replaced).
- Excel round-trips through exceljs can drop charts and images; formula columns are not auto-filled on appended rows.
- The model catalog is cached per server instance for 30 seconds.
- Groq free-tier rate limits apply; the agent reports them instead of failing silently.
- Schema is managed with `drizzle-kit push`; no migration files are committed.

## Layout

```
app/            routes, pages, server actions, API (chat, telegram webhook, cron, exports)
components/     UI (shadcn-style), chat, forms, admin
lib/agent/      models, prompts, tools, streaming and non-streaming runs, profiling
lib/sheets/     xlsx + Google adapters, profile, row operations, exports
lib/data/       user-scoped data access (admin.ts is the only cross-user module, metadata only)
lib/telegram/   Bot API client, conversation handler, reminders
scripts/        seed, telegram webhook setup
tests/          unit + integration
```
