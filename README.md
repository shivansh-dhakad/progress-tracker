# Streakbook

Streakbook is a personal study and goal tracker. Plan study shifts, tick them off, run a timer, keep a streak, and see where your time goes.

## Features

### Dashboard
- Today's list: timed study-plan shifts first, then daily habits. Weekly and monthly goals sit in a fold below.
- Streak, today's progress ring and the week at a glance.
- **Study-time target:** set hours per day and per week in Settings; the dashboard shows a progress ring and weekly bar.
- **Study timer:** start, pause, resume, or stop and save. Stopping during a planned shift asks "Mark this shift as done?" and counts the time against that shift ("1h 20m of 2h studied"). The timer is saved on the device it runs on.

### Study plans
- Create a plan with a start date, length and weekly shifts (for example 2 shifts a day, Sunday free).
- **Skip on purpose** or **move to another day** from the ⋯ menu on any unfinished shift. Neither counts as missed. A moved shift counts on the day you do it.
- **Edit a running plan:** rename it, change shift times, add or remove shifts, and extend the end date.
- **Pause** for a few days (illness, travel) or until you resume. Paused days have no shifts and never break the streak. Optionally push the end date back by the paused days.
- Day-by-day table and calendar strip for every plan.

### Other goals
- Habits (daily, weekly, monthly; daily habits can be limited to chosen weekdays) and one-time deadlines.
- Archive to keep history, or delete forever (you must type the goal's name).

### Streaks
A day counts when you finish any shift or habit or save a note. Planned rest days (one per week), plan free days and days where every shift was skipped or moved cover a gap, up to 2 per month. Paused plans are always covered. The same rules are explained in the app under "How streaks work".

### Reminders
Notifications a few minutes before each shift. They work while the app is open with no setup. For reminders with the app closed, install it as an app on your phone and follow [REMINDERS_SETUP.md](./REMINDERS_SETUP.md).

### History and Insights
- Search past notes and everything you finished (habits and shifts).
- Weekly review, goals and study time per week, strongest days, completion rate, subject and course progress, deadlines, goals that need attention.

## Getting started

Requirements: Node.js, npm and a Supabase project with email auth enabled.

```sh
npm install
npm run dev
```

Create `.env` in the project root:

```dotenv
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
# optional, for closed-app reminders
VITE_VAPID_PUBLIC_KEY=
```

Add your local and deployed URLs to Supabase Auth > URL configuration.

### Database
- **New database:** run [schema.sql](./schema.sql). It contains everything.
- **Existing database:** run [study_plans_migration.sql](./study_plans_migration.sql) once. It is safe to run again and replaces the older `add_archived_at` and `goal_and_independent_timer` migrations. The app shows a message at the top if a table or column is missing.

## Install on your phone
Deploy over HTTPS, then Add to Home Screen (iPhone: Safari > Share > Add to Home Screen). The app ships a web manifest, icons and a small service worker (no caching, so updates are immediate).

## Commands

```sh
npm run dev      # local development server
npm run build    # production build
npm run preview  # preview the production build
```