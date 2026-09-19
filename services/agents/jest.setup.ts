// Every agent's apiKey() throws if its own env var is unset (see e.g.
// rasid.ts) — these are test-only placeholders, never a real credential,
// standing in for the real ai_agents-registry-issued key each agent
// authenticates to the backend with in a real deployment.
process.env.RASID_API_KEY = "test-rasid-key";
process.env.NAZIM_API_KEY = "test-nazim-key";
process.env.BASHIR_API_KEY = "test-bashir-key";
process.env.RASHID_API_KEY = "test-rashid-key";
