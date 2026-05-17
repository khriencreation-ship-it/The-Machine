import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { processKnowledge, generateEmbedding } from '@/ai/gemini'

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const authHeader = request.headers.get('authorization')
    
    // Authenticate the incoming unit
    if (authHeader !== `Bearer ${process.env.UNIT_SECRET_KEY}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { unit_name, type, summary, data } = body

    if (!unit_name || !data) {
      return NextResponse.json({ error: 'Missing unit_name or data' }, { status: 400 })
    }

    const textToIngest = `[Unit Report: ${unit_name.toUpperCase()}]\nType: ${type || 'General Report'}\nSummary: ${summary || 'No summary provided.'}\n\nData:\n${typeof data === 'string' ? data : JSON.stringify(data, null, 2)}`

    // 1. Log the source
    const { data: sourceData, error: sourceError } = await supabase
      .from('knowledge_sources')
      .insert([{ source_name: `Unit: ${unit_name}`, source_type: 'unit_report', processing_status: 'PROCESSING' }])
      .select()
      .single()

    if (sourceError) throw sourceError

    // 2. Extract structured knowledge and action items
    const structuredData = await processKnowledge(textToIngest)
    
    // 3. Generate Vector Embedding
    const embedding = await generateEmbedding(textToIngest)

    // 4. Store in permanent memory
    const { data: memoryData, error: memoryError } = await supabase
      .from('memory_entries')
      .insert([{ 
          title: `[${unit_name.toUpperCase()}] ${structuredData.title}`,
          summary: structuredData.summary,
          category: structuredData.tags[0] || 'UNIT_REPORT',
          tags: [...structuredData.tags, unit_name],
          content: { raw_text: textToIngest, original_payload: body },
          source_type: 'unit_report',
          source_reference: sourceData.id,
          embedding: embedding
      }])
      .select()
      .single()

    if (memoryError) throw memoryError

    // 5. Update source status
    await supabase
      .from('knowledge_sources')
      .update({ processing_status: 'COMPLETED', processed_at: new Date().toISOString() })
      .eq('id', sourceData.id)

    // 6. Handle Auto-Extracted Action Items
    let scheduledTasksText = ''
    let tasksAdded = 0
    if (structuredData.actionItems && structuredData.actionItems.length > 0) {
      for (const item of structuredData.actionItems) {
        const taskDesc = `[${unit_name.toUpperCase()}] ${item.description}`
        let eventTime = new Date()
        eventTime.setHours(eventTime.getHours() + 1)
        if (item.isoTimestamp) {
          eventTime = new Date(item.isoTimestamp)
        }
        
        const triggerTime = new Date(eventTime.getTime() - 30 * 60000)
        const endTime = new Date(eventTime.getTime() + 60 * 60000)

        await supabase.from('tasks').insert([{
          description: taskDesc,
          original_time: eventTime.toISOString(),
          end_time: endTime.toISOString(),
          trigger_time: triggerTime.toISOString(),
          is_completed: false
        }])
        tasksAdded++
      }
      scheduledTasksText = `\n\n🎯 <b>Auto-Scheduled ${tasksAdded} Action Items</b>`
    }

    // 7. Send Telegram Alert to Admin
    const botToken = process.env.TELEGRAM_BOT_TOKEN
    const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID

    if (botToken && adminChatId) {
      const message = `🤖 <b>Unit Report: ${unit_name.toUpperCase()}</b>\n\n<b>Title:</b> ${structuredData.title}\n<b>Summary:</b> ${structuredData.summary}${scheduledTasksText}`
      
      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: adminChatId,
          text: message,
          parse_mode: 'HTML'
        })
      })
    }

    return NextResponse.json({ 
      status: 'success', 
      ingested: true, 
      actionItemsScheduled: tasksAdded 
    }, { status: 200 })

  } catch (error: any) {
    console.error('Unit Webhook Error:', error)
    return NextResponse.json({ error: 'Internal Server Error', message: error.message }, { status: 500 })
  }
}
