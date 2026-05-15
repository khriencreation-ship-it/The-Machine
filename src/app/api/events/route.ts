import { createClient } from '@/utils/supabase/server'
import { NextResponse } from 'next/server'
import { sendTelegramMessage } from '@/utils/telegram'

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const body = await request.json()

    // Expected body: { source_unit_id: 'uuid', event_type: 'PROPOSAL_READY', payload: {} }
    if (!body.event_type) {
      return NextResponse.json({ error: 'event_type is required' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('events')
      .insert([
        { 
          source_unit_id: body.source_unit_id, 
          event_type: body.event_type, 
          payload: body.payload || {} 
        }
      ])
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Basic Orchestration Logic Example:
    // If event requires approval, queue it in approvals table
    const REQUIRES_APPROVAL = ['PROPOSAL_READY', 'INVOICE_GENERATED', 'OUTREACH_STRATEGY']
    
    if (REQUIRES_APPROVAL.includes(body.event_type)) {
      const { data: approvalData, error: approvalError } = await supabase
        .from('approvals')
        .insert([{ event_id: data.id, status: 'PENDING', context: body.payload }])
        .select()
        .single()
      
      if (approvalError) {
        console.error('Failed to queue approval:', approvalError)
      } else if (approvalData) {
        // Send a Telegram notification to the Admin
        await sendTelegramMessage(
          `🔔 <b>New Approval Required</b>\n\n` +
          `<b>Event:</b> ${body.event_type}\n` +
          `<b>ID:</b> <code>${approvalData.id}</code>\n\n` +
          `Reply with:\n<code>/approve ${approvalData.id}</code>\n<code>/reject ${approvalData.id}</code>`
        )
      }
    }

    return NextResponse.json({ message: 'Event logged successfully', event: data }, { status: 201 })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
