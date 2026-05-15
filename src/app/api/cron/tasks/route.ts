import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import * as googleTTS from 'google-tts-api'
import { generateMorningBriefing } from '@/ai/gemini'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const authHeader = request.headers.get('authorization')
    if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!supabaseUrl || !supabaseKey) throw new Error('Missing Supabase credentials')

    const supabase = createClient(supabaseUrl, supabaseKey)
    const botToken = process.env.TELEGRAM_BOT_TOKEN
    const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID
    if (!botToken || !chatId) throw new Error('Missing Telegram credentials')

    const nowIso = new Date().toISOString()
    const nowLagos = new Date().toLocaleString('en-US', { timeZone: 'Africa/Lagos' })
    const nowLagosDate = new Date(nowLagos)

    // ==========================================
    // 1. PRE-MEETING ALERTS (30 Mins Before)
    // ==========================================
    const { data: dueTasks } = await supabase
      .from('tasks')
      .select('*')
      .eq('is_completed', false)
      .lte('trigger_time', nowIso)

    if (dueTasks && dueTasks.length > 0) {
      for (const task of dueTasks) {
        const textToSpeak = `Jake, this is a reminder. You have a task coming up in 30 minutes: ${task.description}.`
        const audioUrl = googleTTS.getAudioUrl(textToSpeak, { lang: 'en', slow: false, host: 'https://translate.google.com' })

        const telegramRes = await fetch(`https://api.telegram.org/bot${botToken}/sendVoice`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            voice: audioUrl,
            caption: `🚨 <b>TASK REMINDER</b>\n\n<b>${task.description}</b>\n\nEvent Time: ${new Date(task.original_time).toLocaleString('en-US', { timeZone: 'Africa/Lagos' })}`,
            parse_mode: 'HTML'
          })
        })

        if (telegramRes.ok) {
          await supabase.from('tasks').update({ is_completed: true }).eq('id', task.id)
        }
      }
    }

    // ==========================================
    // 2. POST-MEETING DEBRIEFS
    // ==========================================
    const { data: endedTasks } = await supabase
      .from('tasks')
      .select('*')
      .eq('debrief_sent', false)
      .lte('end_time', nowIso)

    if (endedTasks && endedTasks.length > 0) {
      for (const task of endedTasks) {
        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: `📝 <b>Meeting Finished</b>\n\nYour schedule shows that <i>"${task.description}"</i> just ended.\n\nReply with <code>/ingest</code> followed by any notes, action items, or decisions you want me to memorize.`,
            parse_mode: 'HTML'
          })
        })
        await supabase.from('tasks').update({ debrief_sent: true }).eq('id', task.id)
      }
    }

    // ==========================================
    // 3. MORNING BRIEFING (7:00 AM Lagos)
    // ==========================================
    if (nowLagosDate.getHours() === 7 && nowLagosDate.getMinutes() <= 10) {
      const { data: adminSession } = await supabase.from('admin_session').select('*').eq('id', 1).single()
      const todayString = nowLagosDate.toISOString().split('T')[0] // local date string
      
      if (adminSession && adminSession.last_briefing_date !== todayString) {
        // Find tasks for today
        const startOfDay = new Date(nowLagosDate)
        startOfDay.setHours(0,0,0,0)
        const endOfDay = new Date(nowLagosDate)
        endOfDay.setHours(23,59,59,999)
        
        const { data: todaysTasks } = await supabase
          .from('tasks')
          .select('*')
          .gte('original_time', startOfDay.toISOString())
          .lte('original_time', endOfDay.toISOString())

        // Find memories from last 24h
        const yesterday = new Date(nowLagosDate.getTime() - 24 * 60 * 60 * 1000)
        const { data: recentMemories } = await supabase
          .from('memory_entries')
          .select('*')
          .gte('created_at', yesterday.toISOString())

        const briefingMsg = await generateMorningBriefing(todaysTasks || [], recentMemories || [])

        const telegramRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text: briefingMsg, parse_mode: 'HTML' })
        })

        if (telegramRes.ok) {
          await supabase.from('admin_session').update({ last_briefing_date: todayString }).eq('id', 1)
        }
      }
    }

    return NextResponse.json({ status: 'ok' }, { status: 200 })
  } catch (err: any) {
    console.error('Cron job error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
