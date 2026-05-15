import { createClient } from '@supabase/supabase-js'
import { GoogleGenAI } from '@google/genai'

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const supabase = createClient(supabaseUrl, supabaseKey)

async function run() {
  const query = "what do you know about khrien"
  const response = await ai.models.embedContent({
    model: 'gemini-embedding-2',
    contents: query,
  })
  
  const queryEmbedding = response.embeddings[0].values

  const { data, error } = await supabase
    .rpc('match_memory_entries', {
      query_embedding: queryEmbedding,
      match_threshold: 0.5, // Check lower threshold
      match_count: 5
    })
  
  if (error) console.error(error)
  else {
    data.forEach(d => {
      console.log(`[${d.similarity.toFixed(2)}] ${d.title}`)
      console.log(`TYPE: ${d.content.raw_text.substring(0, 100)}...\n`)
    })
  }
}
run()
