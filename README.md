# Replenish

**A personal agent that keeps your home stocked.** It learns how fast your household goes through things from your receipts and order emails, predicts when each one runs out, finds it online, has AI choose the right listing, and pays with PayPal: asking you first, or on its own within limits you set.

Built for the [PayPal AI Hackathon](https://paypalaihackathon.devpost.com/).

**Everything runs in test mode: PayPal's sandbox and Zinc's sandbox. No real money moves and nothing is really bought.**

> Live demo: _add the URL_ · Demo video: _add the YouTube link_

## How it works

```
Receipt photo ─┐
Order email  ──┼─▶ Purchases ─▶ Prediction ─▶ Running low? ─▶ Search stores ─▶ AI chooses ─▶ Buy or ask
Typed in     ──┘   (learns       (how much      (scheduled      (Channel3,       (with a       │
                    wordings)     is left)       check)          Zinc)            reason)      ▼
                                                                                    PayPal pays, Zinc buys,
                                       the order counts as stock when it arrives ◀─ unused money is refunded
```

1. **Get purchases in with little typing.** Photograph a receipt (Google Vision reads it; our own parser and dictionary turn `GV WHL MLK GL` into Milk by Great Value), forward order emails, or type them. You review a receipt before anything is saved, and every wording you confirm is remembered.
2. **Predict.** From the gaps between purchases and any stock counts you give, it estimates what's left, when it runs out, and how sure it is. It explains each estimate, and asks short questions when an answer would help.
3. **Find it.** When something runs low, it searches stores. Rules remove what can't be right, and an **AI model reads the listings** to find the real pack size, spot commercial stock and accessories, and pick what you'd have picked, with a sentence saying why.
4. **Buy or ask.** You can press **Buy for me**, or turn on **auto-buy** per product, which only buys when it is confident and within your limits. Otherwise it asks.
5. **Pay with PayPal.** You connect PayPal once. An order holds the most it could cost, Zinc buys the item, and whatever wasn't used is refunded. You can follow the parcel, and stock counts from the day it's delivered.

## Where PayPal and AI come in

**PayPal** ([src/modules/orders/paypal.ts](src/modules/orders/paypal.ts)): saves your account once with PayPal's vault, charges it later when you aren't there, gives partial and full refunds, and adds tracking to the payment. Every call carries the order's id, so a retry can't charge twice.

**AI** ([src/core/review-listings.ts](src/core/review-listings.ts)): an AI model decides which listing to buy and explains why. It works inside fixed limits: it only sees listings the rules accepted, it answers by number, and its choice goes back through the same checks. It can decide what to buy or decline to buy, but it can't spend past your price limit, the monthly limit, or the confidence floor. Gemini is the default, and changing provider is one small file. Receipts also use machine learning: Google Vision for reading, and a small text model for suggesting matches.

## Safety limits

| Limit | Default | Can the user change it? |
|---|---|---|
| Auto-buy, one order, fees included | $50 | Lower only |
| Auto-buy, one month | $200 | Lower only |
| One Buy for me order, fees included | $150 | No |
| All users together, one month | 100 planned users × $200 = $20,000 | No |
| Confidence before auto-buy | 80% | Higher only |

Auto-buy is off until you turn it on for a product, and a modal explains it first. Settings also shows a dry run of what it would have done this week. Fees are shown before you buy: a $1 ordering fee, plus a service fee of 7% of the store price (at least $1.25).

## Run it yourself

You need Node 22 and a free [Neon](https://neon.tech) Postgres database.

```bash
npm install
# create .env.local with the variables below
npm run db:migrate
npm run dictionary -- seed
npm run dev
```

| Variable | What for | Where to get it |
|---|---|---|
| `DATABASE_URL` | **Required** | Neon |
| `GOOGLE_VISION_API_KEY` | Reading receipts | Google Cloud (first 1,000 a month are free) |
| `CHANNEL3_API_KEY` | Finding household goods | Channel3 (1,000 free searches a month) |
| `ZINC_API_KEY` | Finding food, and placing orders | `npm run zinc:key` makes a free sandbox key |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | Payments | PayPal developer dashboard, sandbox app |
| `PAYPAL_ENV` | `sandbox` (the default) or `live` | |
| `GEMINI_API_KEY` | The AI's choice of listing. Without it, the rules choose alone | Google AI Studio |
| `AI_PROVIDER`, `AI_MODEL`, `AI_REVIEW` | Optional: change the AI, or `AI_REVIEW=off` | |
| `CRON_SECRET` | Guards the scheduled jobs | Any long random string |
| `AUTOBUY_MAX_ORDER`, `AUTOBUY_MAX_MONTH`, `BUY_NOW_MAX_ORDER`, `PLANNED_USERS` | Optional: the limits above | |
| `INGEST_API_KEY`, `EMAIL_WORKER_SECRET`, `EMAIL_DOMAIN` | Optional: the HTTP API and email forwarding | See [cloudflare/email-worker](cloudflare/email-worker/README.md) |
| `REQUIRE_APPROVAL`, `APP_URL` | Optional: approve new accounts by hand; the app's public address | |

To see the agent work without waiting for the schedule, buy something a few times, then:

```bash
npm run restock -- --save      # find what's low and show it on the dashboard
curl -H "Authorization: Bearer $CRON_SECRET" "http://localhost:3000/api/low-stock/check?auto=1"   # the whole job
npm run orders                 # what was ordered, and the month's budget
npm run ai:pick -- "Toilet Paper" --unit rolls --qty 12 --brand Charmin   # the rules' choice beside the AI's
```

## Where things are

| Path | What's there |
|---|---|
| [src/core/](src/core/) | Pure logic: prediction, choosing listings, auto-buy rules, money |
| [src/modules/ingestion/](src/modules/ingestion/) | Receipts, emails, the HTTP API |
| [src/modules/dictionary/](src/modules/dictionary/) | What receipt wordings mean, and how it learns |
| [src/modules/restock/](src/modules/restock/) | The low-stock check, store search, the AI review |
| [src/modules/orders/](src/modules/orders/) | PayPal, Zinc, refunds, tracking, auto-buy |
| [docs/](docs/) | The full design of each part |

```bash
npm test            # fast and offline
npm run test:db     # against a real database, with throwaway users
```

## Known limits

- **Channel3's links can't be used for live orders.** They forward through Channel3's own page, which Zinc's sandbox accepts but live Zinc can't read. This needs solving before real money.
- Food search in Zinc's sandbox returns invented "Sample" listings, marked as such everywhere.
- Email can read Amazon's order confirmations so far.

Built with Next.js, React, Tailwind, Drizzle and Neon Postgres. [MIT license](LICENSE).
