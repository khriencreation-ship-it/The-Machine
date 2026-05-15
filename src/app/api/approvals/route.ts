import { createClient } from '@/utils/supabase/server'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const body = await request.json()

    // Expected body: { approval_id: 'uuid', status: 'APPROVED' | 'REJECTED' }
    if (!body.approval_id || !body.status) {
      return NextResponse.json({ error: 'approval_id and status are required' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('approvals')
      .update({ status: body.status, resolved_at: new Date().toISOString() })
      .eq('id', body.approval_id)
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Orchestration: Trigger next workflow step or unit based on approval

    return NextResponse.json({ message: 'Approval updated successfully', approval: data }, { status: 200 })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
