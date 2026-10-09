# Streakbook

Streakbook is a personal goal and study tracker. It helps you plan goals, record daily progress, keep a streak, and understand how you spend study time.

## Features

### Dashboard

- See today's progress, current streak, and the week's activity at a glance.
- Create and manage goals from the **Manage goals** section.
- Enter and save a note about today's progress.
- Start a standalone study timer. The timer is separate from goals, remains available while moving between pages, and continues running in the background. Pause, resume, or stop and save a session at any time.
- Review project goals separately from recurring goals.

### Goal types

- **Recurring goals:** Set a daily, weekly, or monthly goal. Daily goals can be limited to selected weekdays.
- **Project goals:** Set a target completion date or choose a duration in months from today.
- Add an optional subject tag, course target, and due date where applicable.
- Mark goals complete, archive them to retain their history, or restore archived goals.
- Overdue goals show how long they are past their deadline.

### History

- Browse the activity calendar by month, including completed, missed, open, and planned rest days.
- Plan up to one rest day per week.
- Search and filter saved progress notes and completed goals by month or entry type.

### Insights

- Review weekly completed goals, active days, study time, and your best day.
- Save a weekly reflection prompt.
- View weekly goal-completion and study-time charts, monthly completion rates, and your strongest days.
- See course-target progress, recent activity by goal and subject, upcoming deadlines, and goals that may need attention.
- Use the subject filter to focus supported insights on a selected tag.

## Getting started

### Requirements

- Node.js and npm
- A Supabase project with email authentication enabled

### Install and run locally

```sh
npm install
npm run dev
```

Create a `.env` file in the project root with the Supabase project URL and anon key:

```dotenv
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

The app uses Supabase Auth for sign-up and sign-in. Email verification redirects back to the app's current origin. Add the local and deployed app URLs to the Supabase Auth URL configuration as appropriate.

### Set up the database

For a new Supabase database, run [schema.sql](./schema.sql) in the Supabase SQL Editor.

For a database created using an earlier version of the schema:

1. Run [add_archived_at_migration.sql](./add_archived_at_migration.sql) if it has not already been applied.
2. Run [goal_and_independent_timer_migration.sql](./goal_and_independent_timer_migration.sql) to support project goals and independent study timer sessions.

The timer's current session is kept in the browser so it can continue across navigation and page reloads. Stopped study sessions are saved to Supabase and appear in Insights.

## Commands

```sh
npm run dev      # Start the local development server
npm run build    # Create a production build
npm run preview  # Preview the production build locally
```
