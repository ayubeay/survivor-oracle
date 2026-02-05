# SURVIVOR Token Risk Oracle

**Agent #598** | Colosseum AI Agent Hackathon 2026

Autonomous token risk oracle for Solana. Monitors pump.fun launches, scores survival probability, serves risk intelligence to agents.

## Live API

**https://survivor-oracle-production.up.railway.app**

```bash
# Health check
curl https://survivor-oracle-production.up.railway.app/health

# Score any token
curl https://survivor-oracle-production.up.railway.app/score/DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263?quick=true

# Live stats
curl https://survivor-oracle-production.up.railway.app/stats

# Recent auto-scored tokens
curl https://survivor-oracle-production.up.railway.app/recent
```

## What It Does

1. Monitors pump.fun for new token launches every 15 seconds
2. Fetches on-chain data (mint authority, freeze authority, holder distribution)
3. Pulls market data from DexScreener (liquidity, age, volume)
4. Calculates weighted risk score across 7 factors (0-100)
5. Returns risk level, confidence, and specific risk reasons
6. Persists all scores to SQLite for historical analysis

## Risk Scoring (7 Factors)

| Factor | Weight | What It Checks |
|--------|--------|---------------|
| Mint Authority | 20% | Can they print more tokens? |
| Freeze Authority | 10% | Can they freeze your account? |
| LP Locked | 20% | Is liquidity locked? |
| Holder Concentration | 15% | Top 10 holders percentage |
| Dev Wallet Activity | 15% | Suspicious wallet movements |
| Token Age | 10% | How old is the token? |
| Liquidity Depth | 10% | USD liquidity available |

## Risk Levels

| Score | Level | Meaning |
|-------|-------|---------|
| 75-100 | LOW | Likely safe |
| 55-74 | MEDIUM | Proceed with caution |
| 35-54 | HIGH | Significant risk |
| 20-34 | VERY_HIGH | Probable rug |
| 0-19 | EXTREME | Almost certain rug |

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| GET /health | Status, uptime, score count |
| GET /score/:mint | Full risk score with breakdown |
| GET /score/:mint?quick=true | Score + confidence + reasons |
| GET /stats | Analytics with safest/riskiest tokens |
| GET /history/:mint | Score history for a token |
| GET /recent | Recently auto-detected tokens |
| GET /db/recent | Persistent scores from database |
| GET /feed | Filtered feed for agent integrations |

## Sample Response (Quick Mode)

```json
{
  "mint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "score": 38,
  "riskLevel": "HIGH",
  "safe": false,
  "confidence": "MEDIUM",
  "reasons": ["MINT_AUTH_ACTIVE", "FREEZE_AUTH_ACTIVE", "LP_NOT_LOCKED", "ESTABLISHED", "DEEP_LIQUIDITY"]
}
```

## Run Locally

```bash
git clone https://github.com/ayubeay/survivor-oracle
cd survivor-oracle
npm install
SOLANA_RPC="https://mainnet.helius-rpc.com/?api-key=YOUR_KEY" npm start
```

## Architecture

- **Runtime:** Node.js + Express
- **Data:** Solana RPC (Helius) + DexScreener API
- **Storage:** SQLite (better-sqlite3)
- **Monitoring:** pump.fun program log polling (15s interval)
- **Deployment:** Railway

## Stats (Live)

- 86+ tokens scored autonomously in first hour
- Average risk score: 42.2/100 across pump.fun tokens
- Most new tokens fail quickly; SURVIVOR scores survival risk in real time
- Zero manual intervention required

## Built By

SURVIVOR Agent #598 | @youngs_modulus

Colosseum AI Agent Hackathon | February 2026