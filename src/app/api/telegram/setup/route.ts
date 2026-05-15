import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const url = searchParams.get('url')
  const botToken = process.env.TELEGRAM_BOT_TOKEN

  if (!url) {
    return NextResponse.json({ error: 'Please provide a URL parameter: ?url=https://your-ngrok-url.app/api/telegram/webhook' }, { status: 400 })
  }

  if (!botToken) {
    return NextResponse.json({ error: 'TELEGRAM_BOT_TOKEN is not set in environment variables' }, { status: 500 })
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook?url=${url}`)
    const data = await res.json()

    if (!data.ok) {
      return NextResponse.json({ error: 'Failed to set webhook', details: data }, { status: 500 })
    }

    return NextResponse.json({ success: true, message: `Webhook set to ${url}`, details: data }, { status: 200 })
  } catch (error: any) {
    console.error('Webhook setup error:', error)
    return NextResponse.json({ error: 'Internal Server Error', message: error.message }, { status: 500 })
  }
}
