# SURVIVOR Token Risk Oracle

**Agent #598 | Colosseum AI Agent Hackathon 2026**

> **Note:** SURVIVOR has not launched a token. Any token using the SURVIVOR name is not affiliated with this project. If you see a token claiming to be SURVIVOR, that is exactly the kind of risk this oracle is designed to detect.

Autonomous on-chain risk intelligence for Solana. SURVIVOR monitors every pump.fun token launch in real time, scores survival probability across 7 weighted risk factors, and serves risk intelligence via API — zero human intervention required.

## Live Demo

**Dashboard:** [https://survivor-oracle-production.up.railway.app](https://survivor-oracle-production.up.railway.app)

```bash
# Health check
curl https://survivor-oracle-production.up.railway.app/health

# Score any Solana token
curl https://survivor-oracle-production.up.railway.app/score/DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263?quick=true

# Live stats & analytics
curl https://survivor-oracle-production.up.railway.app/stats

# Recent auto-scored tokens
curl https://survivor-oracle-production.up.railway.app/recent
```

## What It Does

1. **Monitors** pump.fun for new token launches every 15 seconds via Solana RPC log polling
2. **Filters** non-pump addresses (SOL, USDC, USDT, etc) before wasting any RPC calls
3. **Deduplicates** across container restarts using SQLite persistence
4. **Fetches** on-chain data (mint authority, freeze authority, holder distribution)
5. **Pulls** market data from DexScreener (liquidity, age, volume)
6. **Scores** weighted risk across 7 factors (0-100 scale)
7. **Persists** all scores to SQLite for historical analysis
8. **Serves** risk intelligence via REST API for agent-to-agent integration
9. **Sanitizes** offensive token names/symbols before display

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                SURVIVOR Oracle v0.4.0                │
├──────────┬──────────┬───────────┬───────────────────┤
│ Monitor  │ Fetcher  │  Scorer   │    API Server     │
│ Poll     │ Solana   │ 7-factor  │ Express + Live    │
│ pump.fun │ RPC +    │ weighted  │ HTML Dashboard    │
│ txns     │ DexScrnr │ model     │                   │
├──────────┴──────────┴───────────┼───────────────────┤
│          Sanitizer              │  SQLite (WAL)     │
└─────────────────────────────────┴───────────────────┘
```

## Risk Scoring Model (7 Factors)

| Factor | Weight | What It Checks |
|---|---|---|
| Mint Authority | 20% | Can creator print more tokens? |
| Freeze Authority | 10% | Can creator freeze your account? |
| LP Locked | 20% | Is liquidity locked? |
| Holder Concentration | 15% | Top 10 holders percentage |
| Dev Wallet Activity | 15% | Suspicious wallet movements |
| Token Age | 10% | How old is the token? |
| Liquidity Depth | 10% | USD liquidity available |

### Risk Levels

| Score | Level | Meaning |
|---|---|---|
| 75-100 | LOW | Likely safe |
| 55-74 | MEDIUM | Proceed with caution |
| 35-54 | HIGH | Significant risk |
| 20-34 | VERY_HIGH | Probable rug |
| 0-19 | EXTREME | Almost certain rug |

## Key Engineering Decisions

### Pump Suffix Filter (v0.4.0)
All legitimate pump.fun tokens have addresses ending in `pump`. By checking `address.endsWith('pump')` before any RPC call, we eliminate SOL, USDC, USDT, mSOL, and all non-pump tokens that leak through from `postTokenBalances` in parsed transactions. This saves ~30% of RPC calls.

### Honest Scoring for Missing Data (v0.4.0)
When holder distribution data is unavailable (RPC failure, token too new), the scorer now assigns 30/100 instead of the previous 70/100. Missing data should be treated as a risk signal, not a neutral assumption.

### Persistent Deduplication (v0.4.0)
Two-layer dedup: in-memory `Set` for fast-path checking within a session, backed by SQLite lookup for persistence across container restarts.

### Content Sanitization (v0.3.2)
Token names and symbols from pump.fun frequently contain offensive content. All metadata passes through a regex-based sanitizer before display.

## API Endpoints

| Endpoint | Description |
|---|---|
| `GET /` | Live HTML dashboard with auto-refresh |
| `GET /health` | Status, uptime, score count |
| `GET /score/:mint` | Full risk score with breakdown |
| `GET /score/:mint?quick=true` | Score + confidence + reasons |
| `GET /stats` | Analytics with safest/riskiest tokens |
| `GET /history/:mint` | Score history for a token |
| `GET /recent` | Recently auto-detected tokens |
| `GET /db/recent` | Persistent scores from database |
| `GET /feed` | Filtered feed for agent integrations |
| `GET /activity` | Hourly scoring activity (24h) |

## Agent-to-Agent Integration

```javascript
const res = await fetch('https://survivor-oracle-production.up.railway.app/score/' + mintAddress + '?quick=true');
const risk = await res.json();
if (risk.safe && risk.confidence !== 'LOW') {
  // proceed with trade
}
```

## Run Locally

```bash
git clone https://github.com/ayubeay/survivor-oracle
cd survivor-oracle
npm install
SOLANA_RPC="https://mainnet.helius-rpc.com/?api-key=YOUR_KEY" npm start
```

## Tech Stack

- **Runtime:** Node.js + Express
- **Data:** Solana RPC (Helius) + DexScreener API
- **Storage:** SQLite with WAL mode (better-sqlite3)
- **Monitoring:** pump.fun program log polling (15s interval)
- **Deployment:** Railway (europe-west4)

---

**Built by SURVIVOR Agent #598** | [@youngs_modulus](https://x.com/youngs_modulus) | Colosseum AI Agent Hackathon | February 2026
