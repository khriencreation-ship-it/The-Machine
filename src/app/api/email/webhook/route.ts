import { createClient } from '@/utils/supabase/server'
import { NextResponse } from 'next/server'
import { generateEmbedding, processKnowledge } from '@/ai/gemini'

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get('content-type') || ''
    let subject = 'No Subject'
    let text = ''
    let sender = 'Unknown Sender'

    if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')) {
      const formData = await request.formData()
      subject = (formData.get('subject') as string) || 'No Subject'
      text = (formData.get('text') as string) || (formData.get('body') as string) || (formData.get('content') as string) || (formData.get('summary') as string) || ''
      sender = (formData.get('from') as string) || (formData.get('sender') as string) || (formData.get('fromAddress') as string) || 'Unknown Sender'
    } else {
      const body = await request.json()
      subject = body.subject || 'No Subject'
      text = body.text || body.body || body.content || body.summary || ''
      sender = body.from || body.sender || body.fromAddress || 'Unknown Sender'
    }

    if (!text) {
      return NextResponse.json({ error: 'Empty email body' }, { status: 400 })
    }

    const supabase = await createClient()

    // 1. Log the source
    const { data: sourceData, error: sourceError } = await supabase
      .from('knowledge_sources')
      .insert([{ source_name: `Email from ${sender}`, source_type: 'email', processing_status: 'PROCESSING' }])
      .select()
      .single()

    if (sourceError) throw sourceError

    const textToIngest = `Email Subject: ${subject}\nSender: ${sender}\n\nBody:\n${text}`

    // 2. Extract structured knowledge
    const structuredData = await processKnowledge(textToIngest)
    
    // 3. Generate Vector Embedding
    const embedding = await generateEmbedding(textToIngest)

    // 4. Store in Memory
    await supabase
      .from('memory_entries')
      .insert([{ 
          title: structuredData.title,
          summary: structuredData.summary,
          category: structuredData.tags[0] || 'EMAIL',
          tags: structuredData.tags,
          content: { raw_text: textToIngest },
          source_type: 'email',
          source_reference: sourceData.id,
          embedding: embedding
      }])

    // 5. Update status
    await supabase
      .from('knowledge_sources')
      .update({ processing_status: 'COMPLETED', processed_at: new Date().toISOString() })
      .eq('id', sourceData.id)

    // 6. Handle Auto-Extracted Action Items
    let actionItemsCount = 0
    if (structuredData.actionItems && structuredData.actionItems.length > 0) {
      for (const item of structuredData.actionItems) {
        const taskDesc = item.description
        let eventTime = new Date()
        eventTime.setHours(eventTime.getHours() + 1)
        if (item.isoTimestamp) eventTime = new Date(item.isoTimestamp)
        
        const triggerTime = new Date(eventTime.getTime() - 30 * 60000)
        const endTime = new Date(eventTime.getTime() + 60 * 60000)

        await supabase.from('tasks').insert([{
          description: taskDesc,
          original_time: eventTime.toISOString(),
          end_time: endTime.toISOString(),
          trigger_time: triggerTime.toISOString(),
          is_completed: false
        }])
        actionItemsCount++
      }
    }

    // 7. Send Telegram Alert to Admin
    const botToken = process.env.TELEGRAM_BOT_TOKEN
    const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID

    if (botToken && chatId) {
      const msg = `📧 <b>New Email Ingested</b>\n\n<b>From:</b> ${sender}\n<b>Subject:</b> ${subject}\n\n<b>Summary:</b> ${structuredData.summary}${actionItemsCount > 0 ? `\n\n🎯 <b>Auto-Scheduled ${actionItemsCount} Action Items</b>` : ''}`
      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: msg, parse_mode: 'HTML' })
      })
    }

    return NextResponse.json({ status: 'success', ingested: true }, { status: 200 })
  } catch (error: any) {
    console.error('Email webhook error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
