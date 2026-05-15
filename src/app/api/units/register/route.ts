import { createClient } from '@/utils/supabase/server'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const body = await request.json()

    // Expected body: { name: 'hunter', description: '...' }
    if (!body.name) {
      return NextResponse.json({ error: 'Unit name is required' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('units')
      .insert([
        { name: body.name, description: body.description, status: 'ACTIVE' }
      ])
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ message: 'Unit registered successfully', unit: data }, { status: 201 })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
