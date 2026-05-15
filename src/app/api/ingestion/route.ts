import { createClient } from '@/utils/supabase/server'
import { NextResponse } from 'next/server'
import { generateEmbedding, processKnowledge } from '@/ai/gemini'

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const body = await request.json()

    // Expected body: { text: "...", source_name: "Website.pdf", source_type: "pdf" }
    if (!body.text || !body.source_name || !body.source_type) {
      return NextResponse.json({ error: 'text, source_name, and source_type are required' }, { status: 400 })
    }

    // 1. Log the incoming source
    const { data: sourceData, error: sourceError } = await supabase
      .from('knowledge_sources')
      .insert([
        { source_name: body.source_name, source_type: body.source_type, processing_status: 'PROCESSING' }
      ])
      .select()
      .single()

    if (sourceError) throw sourceError

    // 2. Use Gemini to extract structured knowledge (title, summary, tags)
    console.log(`Processing knowledge for ${body.source_name}...`)
    const structuredData = await processKnowledge(body.text)
    
    // 3. Generate Vector Embedding for Semantic Search
    console.log(`Generating embeddings for ${body.source_name}...`)
    const embedding = await generateEmbedding(body.text)

    // 4. Store in Organizational Memory
    const { data: memoryData, error: memoryError } = await supabase
      .from('memory_entries')
      .insert([
        { 
          title: structuredData.title,
          summary: structuredData.summary,
          category: structuredData.tags[0] || 'GENERAL',
          tags: structuredData.tags,
          content: { raw_text: body.text },
          source_type: body.source_type,
          source_reference: sourceData.id,
          embedding: embedding
        }
      ])
      .select()
      .single()

    if (memoryError) throw memoryError

    // 5. Update source status
    await supabase
      .from('knowledge_sources')
      .update({ processing_status: 'COMPLETED', processed_at: new Date().toISOString() })
      .eq('id', sourceData.id)

    return NextResponse.json({ 
      message: 'Knowledge successfully ingested and memorized!', 
      memory_id: memoryData.id,
      extracted_data: structuredData
    }, { status: 201 })

  } catch (err: any) {
    console.error("Ingestion error:", err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
