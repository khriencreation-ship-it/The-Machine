import { NextResponse } from 'next/server'
import { sendTelegramMessage } from '@/utils/telegram'

export async function GET(request: Request) {
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN
    
    if (!token) {
      return NextResponse.json({ error: 'Missing TELEGRAM_BOT_TOKEN' }, { status: 400 })
    }

    // Get the base URL (e.g. from Vercel deployment)
    const host = request.headers.get('host')
    const protocol = process.env.NODE_ENV === 'development' ? 'http' : 'https'
    const baseUrl = `${protocol}://${host}`
    const webhookUrl = `${baseUrl}/api/telegram/webhook`

    // Set the webhook with Telegram
    const response = await fetch(`https://api.telegram.org/bot${token}/setWebhook?url=${webhookUrl}`)
    const data = await response.json()

    if (!data.ok) {
      return NextResponse.json({ error: 'Failed to set webhook', details: data }, { status: 500 })
    }

    // Send the live personalized message to Jake
    await sendTelegramMessage(
      `🧠 <b>The Brain is online.</b>\n\n` + 
      `Hi Jake, I am live now. Ready to build and manage the core of Khrien.\n\n` +
      `As the main Admin, I will notify you here of any pending approvals and system events.`
    )

    return NextResponse.json({ 
      message: 'Webhook set successfully and live message sent!', 
      webhookUrl 
    }, { status: 200 })

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
