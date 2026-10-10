// Sends a Web Push when a study-plan shift is about to start.
// Run it every minute (see REMINDERS_SETUP.md). Needs secrets:
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:you@example.com), CRON_SECRET
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase automatically.
import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT')!, Deno.env.get('VAPID_PUBLIC_KEY')!, Deno.env.get('VAPID_PRIVATE_KEY')!)

const MS_DAY = 864e5
const utc = (s: string) => Date.parse(`${s}T00:00:00Z`)
const dowOf = (s: string) => (new Date(utc(s)).getUTCDay() + 6) % 7           // Mon = 0
const dayDiff = (a: string, b: string) => Math.round((utc(a) - utc(b)) / MS_DAY)
const minutes = (hm: string) => { const [h, m] = hm.split(':').map(Number); return h * 60 + m }

/* the current date and HH:MM in the subscriber's time zone */
function nowIn(tz: string) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date()).map((x) => [x.type, x.value]))
  return { date: `${p.year}-${p.month}-${p.day}`, min: Number(p.hour) * 60 + Number(p.minute) }
}
const pausedOn = (ranges: [string, string | null][], date: string) => (ranges || []).some(([a, b]) => date >= a && (!b || date <= b))

Deno.serve(async (req) => {
  if (req.headers.get('x-cron-secret') !== Deno.env.get('CRON_SECRET')) return new Response('forbidden', { status: 403 })

  const { data: subs } = await db.from('push_subscriptions').select('*')
  const byUser: Record<string, any[]> = {}
  ;(subs || []).forEach((s) => (byUser[s.user_id] ||= []).push(s))
  let sent = 0, removed = 0

  for (const [userId, devices] of Object.entries(byUser)) {
    const { data: settings } = await db.from('user_settings').select('reminder_lead').eq('user_id', userId).maybeSingle()
    const lead = settings?.reminder_lead ?? 5
    const { data: plans } = await db.from('goals').select('id,title,start_date,plan_days,schedule,paused_ranges')
      .eq('user_id', userId).eq('period', 'plan').eq('archived', false)
    if (!plans?.length) continue
    const ids = plans.map((p) => p.id)

    for (const dev of devices) {
      const { date, min } = nowIn(dev.tz || 'UTC')
      const { data: rows } = await db.from('slot_completions').select('goal_id,done_on,slot_idx,status,moved_to,moved_done')
        .in('goal_id', ids).or(`done_on.eq.${date},moved_to.eq.${date}`)
      const due: { title: string; s: string; e: string; tag: string }[] = []

      for (const g of plans) {
        const sched = g.schedule || {}
        const idx = dayDiff(date, g.start_date)
        if (idx >= 0 && idx < (g.plan_days || 30) && !pausedOn(g.paused_ranges, date)) {
          ;(sched[dowOf(date)] || []).forEach((sl: any[], j: number) => {
            if (sl[2]) return                                                    // removed shift
            if ((rows || []).some((r) => r.goal_id === g.id && r.done_on === date && r.slot_idx === j)) return // done, skipped or moved
            due.push({ title: g.title, s: sl[0], e: sl[1], tag: `shift-${g.id}-${date}-${j}` })
          })
        }
        // shifts moved onto today
        ;(rows || []).filter((r) => r.goal_id === g.id && r.status === 'moved' && r.moved_to === date && !r.moved_done).forEach((r) => {
          const sl = (sched[dowOf(r.done_on)] || [])[r.slot_idx]
          if (sl && !sl[2]) due.push({ title: g.title, s: sl[0], e: sl[1], tag: `shift-${g.id}-${date}-${r.slot_idx}-${r.done_on}` })
        })
      }

      for (const d of due) {
        const at = minutes(d.s) - lead
        if (min < at || min >= at + 1) continue                                  // exactly this minute (cron runs every minute)
        const body = lead ? `Shift ${d.s} – ${d.e} starts in ${lead} min` : `Shift ${d.s} – ${d.e} starts now`
        try {
          await webpush.sendNotification({ endpoint: dev.endpoint, keys: { p256dh: dev.p256dh, auth: dev.auth } },
            JSON.stringify({ title: d.title, body, tag: d.tag, url: '/' }))
          sent++
        } catch (err: any) {
          if (err?.statusCode === 404 || err?.statusCode === 410) { await db.from('push_subscriptions').delete().eq('id', dev.id); removed++ }
          else console.error('push failed', err?.statusCode, err?.body)
        }
      }
    }
  }
  return Response.json({ sent, removed })
})