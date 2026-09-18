# DeepSeek Usage · Hermes Plugin

A Hermes Desktop plugin that shows your **DeepSeek API balance** live in the status bar, with a right-hand pane for **peak/off-peak pricing, switch countdown, unit prices, and spend trend**.

```
DS · ¥42.17 ❄️        ← status-bar chip (balance + pricing phase)
```

## Features

| Area | Content |
|------|---------|
| Status-bar chip | `DS · ¥balance` + 🔥 peak / ❄️ idle marker; click for a full tooltip |
| Right pane | Balance (total / topped-up / granted), pricing phase + countdown, current unit prices, today / last-7-day spend |

- **Balance**: calls `GET https://api.deepseek.com/user/balance` with a 5-minute cache.
- **Peak/off-peak pricing**: peak = Beijing time Mon–Fri `9:00–12:00` and `14:00–18:00`; everything else is idle, where idle price = peak price × 0.5. The pane shows the countdown to the next switch.
- **Spend trend**: each balance fetch writes a snapshot (minimum 10-minute gap, capped at 2000 entries), used to estimate today's and the last 7 days' spend.

## Installation

Drop the whole `deepseek-usage/` directory into your Hermes plugin directory:

```
$HERMES_HOME/plugins/deepseek-usage/          # Windows default: AppData\Local\hermes\plugins\...
├── plugin.yaml
├── dashboard/          # backend (FastAPI router)
│   ├── manifest.json
│   └── plugin_api.py
├── desktop/            # frontend (status-bar chip + pane)
│   └── plugin.js
└── data/               # runtime balance snapshots (balance_history.json)
```

Restart the Hermes gateway / desktop app to activate.

## API key

The plugin reads the key **server-side only and never sends it to the frontend**. Provide `DEEPSEEK_API_KEY` in either way:

1. Environment variable `DEEPSEEK_API_KEY`
2. Hermes env file `$HERMES_HOME/.env`:

   ```
   DEEPSEEK_API_KEY=sk-xxxxxxxxxxxxxxxx
   ```

When unset the pane shows `DEEPSEEK_API_KEY not found` instead of crashing.

## API endpoints

Mounted at `/api/plugins/deepseek-usage/`:

| Method | Path | Description |
|--------|------|-------------|
| GET | `/balance` | Balance + today / last-7-day spend (5-min cache, auto snapshot) |
| GET | `/pricing` | Current pricing phase, switch time, countdown, price table |
| GET | `/history` | Balance snapshot history (returns the latest 500 points) |

Sample `/balance` response:

```json
{
  "ok": true,
  "balance": 42.17,
  "currency": "CNY",
  "granted": 0.0,
  "topped_up": 42.17,
  "spent_today": 1.32,
  "spent_week": 8.05,
  "snapshots": 214,
  "checked_at": 1758268800.0
}
```

## Price table (USD per 1M tokens, idle price; peak = ×2)

| Model | Input | Output | Cache read |
|-------|-------|--------|------------|
| deepseek-flash | 0.15 | 0.60 | 0.003 |
| deepseek-v4-pro | 0.66 | 1.98 | 0.022 |

> Snapshot dated 2026-09-10 from the DeepSeek official pricing page. When prices change, edit the `PRICES` constant in `dashboard/plugin_api.py`.

## Notes

- The peak/off-peak rules and prices are **community-maintained**; the official DeepSeek documentation always wins. This plugin is display-only and takes no part in billing.
- The snapshot file `data/balance_history.json` is local runtime data and is excluded via `.gitignore`.

## License

MIT
