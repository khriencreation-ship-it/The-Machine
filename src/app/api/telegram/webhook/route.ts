import { createClient } from '@/utils/supabase/server'
import { NextResponse } from 'next/server'
import { sendTelegramMessage } from '@/utils/telegram'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    
    // Ignore messages without text
    if (!body.message || !body.message.text) {
      return NextResponse.json({ status: 'ignored' }, { status: 200 })
    }

    const chatId = body.message.chat.id.toString()
    const text = body.message.text.trim()
    const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID

    // Capture the Chat ID securely if not set up
    if (!adminChatId) {
      console.log(`========================================`)
      console.log(`🔔 NEW TELEGRAM CHAT ID DETECTED: ${chatId}`)
      console.log(`Add this to your .env.local as TELEGRAM_ADMIN_CHAT_ID`)
      console.log(`========================================`)
      return NextResponse.json({ status: 'ok' }, { status: 200 })
    } else if (chatId !== adminChatId) {
      // Unauthorized user
      return NextResponse.json({ status: 'unauthorized' }, { status: 200 })
    }

    // Only process commands if authorized
    if (chatId === adminChatId) {
      if (text.startsWith('/approve ') || text.startsWith('/reject ')) {
        const parts = text.split(' ')
        const command = parts[0]
        const approvalId = parts[1]

        if (!approvalId) {
          await sendTelegramMessage('Please provide an approval ID: /approve [id]')
          return NextResponse.json({ status: 'ok' }, { status: 200 })
        }

        const statusToSet = command === '/approve' ? 'APPROVED' : 'REJECTED'
        const supabase = await createClient()

        const { data, error } = await supabase
          .from('approvals')
          .update({ status: statusToSet, resolved_at: new Date().toISOString() })
          .eq('id', approvalId)
          .select()
          .single()

        if (error) {
          await sendTelegramMessage(`Error updating approval: ${error.message}`)
        } else {
          await sendTelegramMessage(`✅ Successfully marked approval <b>${approvalId}</b> as ${statusToSet}`)
        }
      } else if (text === '/start') {
         await sendTelegramMessage('🧠 <b>The Brain is online.</b>\n\nHi Jake, I am live now. Ready to build and manage the core of Khrien.\n\nAs the main Admin, I will notify you here of any pending approvals and system events.')
      } else {
         await sendTelegramMessage('Unrecognized command, Jake. Use /approve [id] or /reject [id].')
      }
    }

    return NextResponse.json({ status: 'ok' }, { status: 200 })
  } catch (error) {
    console.error('Telegram webhook error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
