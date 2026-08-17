# Magic City MCP

Magic City now has two MCP surfaces:

1. a local stdio bridge for Codex and other desktop MCP clients
2. a hosted remote MCP endpoint for ChatGPT-style installs

In both cases, Magic City remains the system of record for:

- credits and wallet state
- Stripe / Square payment rails
- agent execution
- Zeko proofs, anchor prep, and settlement truth

The MCP layer is just the control plane.

## What it exposes

- `register_account`
- `login_account`
- `logout_account`
- `route_intent`
- `get_intent`
- `get_account_history`
- `list_actions`
- `get_action`
- `approve_action`
- `reject_action`
- `get_connector_session`
- `start_connector_execution`
- `list_execution_agents`
- `list_settlement_registry`
- `get_settlement_registry_entry`
- `register_settlement_commitment`
- `get_wallet`
- `create_credit_topup`

Resources:

- `magic-city://execution-agents`
- `magic-city://auth-session`
- `magic-city://auth-history`
- `magic-city://billing/stripe-config`
- `magic-city://billing/square-config`
- `magic-city://zeko/settlement-registry`

The settlement registry is the lightweight Zeko protocol surface:

- platform-auto entries for sponsored settlement proofs and anchor prep
- external memo-based commitments
- external signature-based commitments

It is intentionally commitment-first and anchor-aware, without recursive on-chain proof verification.

## Hosted remote MCP

Public endpoint:

- `https://magic-city-staging.fly.dev/mcp`

OAuth + discovery endpoints:

- `https://magic-city-staging.fly.dev/.well-known/oauth-authorization-server`
- `https://magic-city-staging.fly.dev/.well-known/openid-configuration`
- `https://magic-city-staging.fly.dev/mcp/.well-known/oauth-protected-resource`

What this gives us:

- ChatGPT or any remote MCP client can connect to Magic City over HTTP
- users authenticate with Magic City, not a duplicate account system
- access is granted through scoped OAuth bearer tokens
- credits, payments, settlement, and Zeko proofs remain inside Magic City

### ChatGPT connection model

The intended install flow is:

1. add the Magic City MCP URL in ChatGPT:
   - `https://magic-city-staging.fly.dev/mcp`
2. ChatGPT discovers the OAuth metadata
3. the user signs into Magic City in the authorization window
4. Magic City issues a scoped bearer token
5. ChatGPT uses that token for MCP tool calls

The remote MCP surface intentionally hides local-only auth tools like `register_account`, `login_account`, and `logout_account`, because account connection should happen through OAuth rather than tool calls.

## Run it locally

From the Magic City repo:

```bash
npm run start:mcp
```

The MCP server talks to the Magic City backend over HTTP.
If the backend is not running or reachable, tool calls will return a clear `magic_city_backend_unreachable` error with the target base URL.

## Environment

- `MAGIC_CITY_BASE_URL`
  - Backend API base URL
  - default: `https://magic-city-staging.fly.dev`
- `MAGIC_CITY_APP_URL`
  - Used for default Stripe success/cancel URLs
  - default: same as `MAGIC_CITY_BASE_URL`
- `MAGIC_CITY_REQUESTER_ID`
  - Default requester identity for intent routing and top-ups
- `MAGIC_CITY_SESSION_COOKIE`
  - Optional `magic_city_session` cookie value for account-scoped routes like `get_wallet`
- `MAGIC_CITY_PUBLIC_API_KEY`
  - Optional public API key if a deployment requires it for specific routes
- `MCP_OAUTH_SECRET`
  - Secret used to sign and protect Magic City MCP OAuth artifacts
- `MCP_OAUTH_CODE_TTL_SEC`
  - Authorization code lifetime
- `MCP_OAUTH_ACCESS_TTL_SEC`
  - Access token lifetime
- `MCP_OAUTH_REFRESH_TTL_SEC`
  - Refresh token lifetime

## Codex config example

```json
{
  "mcpServers": {
    "magic-city": {
      "command": "node",
      "args": [
        "/Users/evankereiakes/Documents/Codex/agent-verification/src/magicCityMcpServer.js"
      ],
      "env": {
        "MAGIC_CITY_BASE_URL": "https://magic-city-staging.fly.dev",
        "MAGIC_CITY_APP_URL": "https://magic-city-staging.fly.dev",
        "MAGIC_CITY_REQUESTER_ID": "you@example.com"
      }
    }
  }
}
```

## Codex plugin package

A repo-local Codex plugin is included here:

- plugin manifest:
  - `/Users/evankereiakes/Documents/Codex/agent-verification/plugins/magic-city/.codex-plugin/plugin.json`
- MCP config:
  - `/Users/evankereiakes/Documents/Codex/agent-verification/plugins/magic-city/.mcp.json`
- repo marketplace entry:
  - `/Users/evankereiakes/Documents/Codex/agent-verification/.agents/plugins/marketplace.json`

## Notes

- `route_intent` is the main entry point. It lets Codex hand work to Magic City without going through the web UI.
- `approve_action` and `start_connector_execution` let Codex continue approval-driven flows like food, reminders, or meeting follow-through.
- `register_account` and `login_account` store the `magic_city_session` cookie inside the MCP process, so later `get_wallet`, `get_account_history`, and `create_credit_topup` calls work account-scoped without extra manual plumbing.
- The hosted `/mcp` endpoint uses OAuth instead of session-cookie plumbing.
- The remote OAuth surface is deliberately lightweight:
  - dynamic client registration
  - PKCE authorization code flow
  - refresh tokens
  - no recursive on-chain proof verification
- Zeko stays behind the scenes as protocol truth for execution, attestations, and settlement records.
