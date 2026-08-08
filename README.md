# GrantSeeker — GrantPilot Ireland

A five-agent AI chatbot that matches Irish organisations to **live** state grant opportunities.

Live site: <https://lauramottaprojects.github.io/grantpilot/>

## How it works

1. You describe your organisation (size, sector, location, funding need) in one message.
2. Five specialist agents work automatically, and each agent's output is posted to the chat as a labelled **evidence card** in order:

| # | Agent | Role |
|---|-------|------|
| 1 | **Maeve** — Researcher | Queries the **live** grants registry at runtime via a `search_grants()` tool call (no hardcoded data) |
| 2 | **Conor** — Designer | Scores and structures the shortlist into a funding plan |
| 3 | **Niamh** — Maker | Builds the user-facing version of the funding brief |
| 4 | **Orla** — Communicator | Explains the recommendations in plain English |
| 5 | **Eoin** — Manager | Reviews the whole chain and signs off, with sources |

## Architecture

- **Frontend** (this repo): static site on GitHub Pages — no secrets.
- **Agent backend**: Vercel serverless function `api/agent.mjs`, which proxies each stage's prompt to **Gemini** (`gemini-3.1-flash-lite`). The Gemini API key lives only in a Vercel environment variable — never in the browser.
- **Live data**: the National Enterprise Hub grants registry (CC BY 4.0) served through a Google Sheets feed, fetched live by the Researcher agent's tool call at request time.

## Local terminal chat

```bash
npm run chat   # requires GEMINI_API_KEY env var or ./gemini-api-key.txt (gitignored)
```

Transcripts of every run are saved to `runs/`.

## Data & attribution

Grants data © National Enterprise Hub / TenderWatch Ireland, CC BY 4.0.
GrantSeeker is a discovery aid, not a grants adviser — verify eligibility with the issuing agency.
