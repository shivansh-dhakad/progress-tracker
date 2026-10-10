# Shift reminders: setup

Reminders work in two layers.

1. **App open (no setup).** Settings > "Turn reminders on for this device" asks for notification permission.
   While Streakbook is open in a tab or installed app, you get a notification a few minutes before each shift.
2. **App closed (Web Push, one-time setup below).** A Supabase Edge Function runs every minute and pushes a
   notification to your phone or laptop even when the app is closed.

> A web page cannot wake itself up at 19:00 on its own. Layer 2 is the only way to get a nudge with the app closed.

## Phone: install the app first
- **Android (Chrome):** menu > Install app / Add to Home screen.
- **iPhone (Safari):** Share > Add to Home Screen, then open Streakbook from the Home Screen icon. Push on iPhone only
  works for the installed app, on iOS 16.4 or later.

You need HTTPS (any normal host such as Vercel or Netlify). `npm run build` then deploy; push does not work from `npm run dev`
on a phone unless it is served over HTTPS.

## One-time server setup

1. Run `study_plans_migration.sql` in the Supabase SQL Editor (creates `push_subscriptions` and `user_settings`).
2. Generate a VAPID key pair:
   ```sh
   npx web-push generate-vapid-keys
   ```
3. Put the **public** key in your app's environment (and redeploy):
   ```dotenv
   VITE_VAPID_PUBLIC_KEY=BNc...
   ```
4. Install the Supabase CLI, link your project, and set the function secrets:
   ```sh
   supabase secrets set VAPID_PUBLIC_KEY=BNc... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:you@example.com CRON_SECRET=pick-a-long-random-string
   supabase functions deploy send-shift-reminders --no-verify-jwt
   ```
5. Schedule it every minute. In the SQL Editor (enable the `pg_cron` and `pg_net` extensions first under Database > Extensions):
   ```sql
   select cron.schedule('shift-reminders', '* * * * *', $$
     select net.http_post(
       url := 'https://YOUR-PROJECT.supabase.co/functions/v1/send-shift-reminders',
       headers := jsonb_build_object('x-cron-secret', 'pick-a-long-random-string')
     );
   $$);
   ```
6. In the app: Settings > Turn reminders on for this device. Do this on each device you want reminders on.

## Check it works
- Call the function by hand and read the reply (`{"sent":N,"removed":M}`):
  ```sh
  curl -X POST https://YOUR-PROJECT.supabase.co/functions/v1/send-shift-reminders -H "x-cron-secret: pick-a-long-random-string"
  ```
- A reminder is sent only when a shift starts exactly "lead minutes" from now, is not already done, skipped or moved,
  and its plan is not paused. The app and the server use the same notification tag, so you never get two for one shift.

## Turning it off
Settings > Turn reminders off on this device (also removes the saved subscription).