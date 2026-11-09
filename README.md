# TaskPay

A simple task and payout app with a React + Vite client and an Express API backed by Supabase. Users earn points from daily tasks and can request a payout at 100 points per $0.50.

## Requirements

- Node.js 20.19+ or 22.12+
- npm

## Run locally

```powershell
cd C:\Users\Denzel\Desktop\Task-Rewards
npm install
Copy-Item .env.example .env
npm run dev
```

Before starting the app, set `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` in `.env` and run the SQL in `server/supabase.sql` in the Supabase SQL Editor. The API starts without these settings, but database-backed routes return a configuration error until they are added. Keep the service key on the server and never expose it to the client.

Open the Vite URL printed in the terminal (normally http://localhost:5173). The API runs on http://localhost:3001. Register with `admin@taskrewards.test` to access `/admin`; change `ADMIN_EMAIL` in `.env` to choose a different admin account.

For a production build, run `npm run build`. Start the API with `npm start`. Set a strong, unique `JWT_SECRET` before exposing the service publicly.

## Notes

- Google AdSense is not connected. The video task is a playback placeholder and unlocks completion after 30 seconds of playback.
- Task completion is limited to one completion per task per user per UTC day. The server is authoritative for points and balances.
- Payout requests are persisted as pending requests and also logged by the API; no payment provider is connected.
- Deposits use the Airtel Money sandbox. Set `AIRTEL_CLIENT_ID` and `AIRTEL_CLIENT_SECRET` in `.env`; deposits credit points only after Airtel confirms payment. The sandbox base URL, country, and currency are configurable with `AIRTEL_BASE_URL`, `AIRTEL_COUNTRY`, and `AIRTEL_CURRENCY`.
- Point conversion for Airtel deposits is currently 1 KES = 1 point. A referred user's first confirmed deposit adds a 30% bonus to the referrer's points.
- Referral codes are user IDs and can only be applied during registration.
- Configure Airtel to send transaction callbacks to `/api/webhooks/airtel`. Callback details are verified against Airtel's payment status API before any balance is credited.
- User, task, payout, Airtel transaction, and referral data is stored in Supabase.