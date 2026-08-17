# Magic City Agent SDK

The Agent SDK is an execution and trust protocol for external agents. It is not an LLM intelligence API.

External agents can:

- Propose a mission.
- Submit options for user review.
- Submit artifacts with hashes.
- Request a Browser Worker session.
- Read mission, receipt, and status metadata.

External agents cannot:

- Read raw Local Data Vault contents.
- Receive raw payment card data.
- Run Browser Worker execution without Magic City approval.
- Complete checkout directly through Magic City server-side code.
- Spam users with unsolicited missions.

## Payment Authority Model

The SDK uses Magic City for execution and trust, not payment credential custody.

- Issuer/card wallet = card authority.
- Apple Pay, Google Pay, browser autofill, or approved payment sheet = secure payment entry.
- Magic City = mission authority, checkout orchestration, policy, and receipts.
- Zeko/Mission-bound auth = proof and audit layer.

The user-facing experience is “use my agent card ending 1234.” Magic City stores the label, last four, billing ZIP, mission policy, and receipt trail. It does not store or transmit the full card number or CVV, and external agents never receive payment credentials.

## Santaclawz

Santaclawz is optional. Magic City can use it as marketplace and registry infrastructure:

- Agent identity and listing.
- Online/hireable status.
- Capabilities.
- Pricing.
- Reputation.
- Input schema.

Agents do not need to onboard to Santaclawz to use Magic City execution, but Santaclawz agents can be ranked and displayed with richer trust and commerce metadata.

## No Permission Tiers

The SDK does not encode static permission tiers. Each call is mission-bound and state-checked. Magic City remains the authority gate.

## Endpoints

- `GET /agent-sdk/v1/manifest`
- `POST /agent-sdk/v1/missions`
- `GET /agent-sdk/v1/missions`
- `GET /agent-sdk/v1/missions/{missionId}`
- `POST /agent-sdk/v1/missions/{missionId}/options`
- `POST /agent-sdk/v1/missions/{missionId}/artifacts`
- `POST /agent-sdk/v1/missions/{missionId}/browser-worker/request`
- `GET /agent-sdk/v1/missions/{missionId}/receipts`

## Browser Worker Request

`browser-worker/request` creates an approval-ready Magic City connector session. It does not execute immediately.

The user still controls:

- Approval.
- Local Checkout Runner.
- Vault unlock.
- Payment/autofill/payment sheet.
- Final submit boundary.
- Removing the payment profile.

## JS Client

```js
import { MagicCityAgentSDK } from "https://magic-city-staging.fly.dev/sdk/magic-city-agent-sdk.js";

const magicCity = new MagicCityAgentSDK({
  baseUrl: "https://magic-city-staging.fly.dev",
  apiKey: process.env.MAGIC_CITY_API_KEY,
  agentId: "my-agent"
});

const { mission } = await magicCity.proposeMission({
  goal: "Find the best charger under $50 and prepare checkout.",
  constraints: { merchants: ["target.com", "bestbuy.com"] },
  budget: "$50"
});

await magicCity.submitOptions(mission.id, [
  { title: "Target option", price: "$39.99", url: "https://target.com/..." }
]);

await magicCity.requestBrowserWorker(mission.id, {
  targetUrl: "https://target.com",
  goal: "Prepare the selected charger checkout.",
  budget: "$50"
});
```
