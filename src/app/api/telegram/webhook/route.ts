import { createClient } from '@/utils/supabase/server'
import { NextResponse } from 'next/server'
import { sendTelegramMessage } from '@/utils/telegram'
import { generateEmbedding, processKnowledge, synthesizeAnswer, extractKnowledgeFromFile } from '@/ai/gemini'
import { scrapeWebsite } from '@/utils/scraper'
import { downloadTelegramFile } from '@/utils/telegram_files'
import fs from 'fs'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    
    const msg = body.message
    if (!msg) {
      return NextResponse.json({ status: 'ignored' }, { status: 200 })
    }

    const text = (msg.text || msg.caption || '').trim()
    
    // Ignore messages without any text/caption AND without any file
    const hasFile = !!(msg.document || msg.photo || msg.video)
    if (!text && !hasFile) {
      return NextResponse.json({ status: 'ignored' }, { status: 200 })
    }

    const chatId = msg.chat.id.toString()
    const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID
    const botToken = process.env.TELEGRAM_BOT_TOKEN

    // Helper to send messages and get the message_id back
    async function reply(msg: string) {
      if (!botToken) return null;
      const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: msg, parse_mode: 'HTML' }),
      })
      const data = await res.json()
      return data.result?.message_id
    }

    // Helper to edit messages
    async function editReply(messageId: number, msg: string) {
      if (!botToken) return;
      await fetch(`https://api.telegram.org/bot${botToken}/editMessageText`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, message_id: messageId, text: msg, parse_mode: 'HTML' }),
      })
    }

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

    // Process logic if authorized
    if (chatId === adminChatId) {
      const supabase = await createClient()

      // --- DYNAMIC SECURITY LOCK LOGIC ---
      let { data: sessionData } = await supabase.from('admin_session').select('*').eq('id', 1).single()
      if (!sessionData) {
        const { data: newData } = await supabase.from('admin_session').insert([{ id: 1, last_active_at: new Date().toISOString(), is_locked: false }]).select().single()
        sessionData = newData
      }

      if (sessionData) {
        const lastActive = new Date(sessionData.last_active_at).getTime()
        const now = new Date().getTime()
        const inactiveMinutes = (now - lastActive) / 60000
        let isLocked = sessionData.is_locked

        if (!isLocked && inactiveMinutes > 20) {
          isLocked = true
          await supabase.from('admin_session').update({ is_locked: true }).eq('id', 1)
        }

        if (isLocked) {
          const { verifyDynamicCode } = await import('@/utils/security')
          if (verifyDynamicCode(text)) {
            await supabase.from('admin_session').update({ is_locked: false, last_active_at: new Date().toISOString() }).eq('id', 1)
            await reply('🔓 <b>Identity Verified. Welcome back, Jake.</b>')
            return NextResponse.json({ status: 'ok' }, { status: 200 })
          } else {
            await reply('🔒 <b>The Machine is locked.</b>\nAuthentication required. Please provide the dynamic verification code.')
            return NextResponse.json({ status: 'ok' }, { status: 200 })
          }
        } else {
          // Keep-alive
          await supabase.from('admin_session').update({ last_active_at: new Date().toISOString() }).eq('id', 1)
        }
      }
      // --- END SECURITY LOGIC ---

      if (text.startsWith('/approve ') || text.startsWith('/reject ')) {
        // --- EXISTING APPROVAL LOGIC ---
        const parts = text.split(' ')
        const command = parts[0]
        const approvalId = parts[1]

        if (!approvalId) {
          await reply('Please provide an approval ID: /approve [id]')
          return NextResponse.json({ status: 'ok' }, { status: 200 })
        }

        const statusToSet = command === '/approve' ? 'APPROVED' : 'REJECTED'

        const { data, error } = await supabase
          .from('approvals')
          .update({ status: statusToSet, resolved_at: new Date().toISOString() })
          .eq('id', approvalId)
          .select()
          .single()

        if (error) {
          await reply(`Error updating approval: ${error.message}`)
        } else {
          await reply(`✅ Successfully marked approval <b>${approvalId}</b> as ${statusToSet}`)
        }

      } else if (text === '/start') {
         await reply('🧠 <b>The Brain is online.</b>\n\nHi Jake, I am live now. I can manage approvals, ingest new knowledge via <code>/ingest</code>, and answer any questions based on my memory.')

      } else if (hasFile && text.startsWith('/ingest')) {
        // --- MULTI-MODAL FILE INGESTION LOGIC ---
        const ingestNote = text.replace('/ingest', '').trim()
        let fileId = ''
        
        if (msg.document) fileId = msg.document.file_id
        else if (msg.video) fileId = msg.video.file_id
        else if (msg.photo && msg.photo.length > 0) fileId = msg.photo[msg.photo.length - 1].file_id

        const processingMsgId = await reply('📥 <i>Downloading file...</i>')

        let tempFilePath = ''
        try {
          // Download file
          const { filePath, mimeType, fileName } = await downloadTelegramFile(fileId)
          tempFilePath = filePath

          if (processingMsgId) await editReply(processingMsgId, `🧠 <i>Analyzing file contents with Gemini Vision...</i>`)
          
          // Extract text from file using Gemini
          const extractedText = await extractKnowledgeFromFile(tempFilePath, mimeType)
          const textToIngest = `File Name: ${fileName}\n\nExtracted Content:\n${extractedText}\n\nContext Note: ${ingestNote}`

          if (processingMsgId) await editReply(processingMsgId, `💾 <i>Memorizing extracted knowledge...</i>`)

          // 1. Log the source
          const { data: sourceData, error: sourceError } = await supabase
            .from('knowledge_sources')
            .insert([{ source_name: fileName, source_type: 'file', processing_status: 'PROCESSING' }])
            .select()
            .single()

          if (sourceError) throw sourceError

          // 2. Extract structured knowledge
          const structuredData = await processKnowledge(textToIngest)
          
          // 3. Generate Vector Embedding
          const embedding = await generateEmbedding(textToIngest)

          // 4. Store in Memory
          const { data: memoryData, error: memoryError } = await supabase
            .from('memory_entries')
            .insert([{ 
                title: structuredData.title,
                summary: structuredData.summary,
                category: structuredData.tags[0] || 'GENERAL',
                tags: structuredData.tags,
                content: { raw_text: textToIngest },
                source_type: 'file',
                source_reference: sourceData.id,
                embedding: embedding
            }])
            .select()
            .single()

          if (memoryError) throw memoryError

          // 5. Update status
          await supabase
            .from('knowledge_sources')
            .update({ processing_status: 'COMPLETED', processed_at: new Date().toISOString() })
            .eq('id', sourceData.id)

          if (processingMsgId) {
            await editReply(processingMsgId, `✅ <b>Media Knowledge Ingested</b>\n\n<b>Title:</b> ${structuredData.title}\n<b>Tags:</b> ${structuredData.tags.join(', ')}`)
          }
        } catch (error: any) {
          console.error('File Ingestion error:', error)
          if (processingMsgId) await editReply(processingMsgId, `❌ Error ingesting file: ${error.message}`)
        } finally {
          // Cleanup temp file
          if (tempFilePath && fs.existsSync(tempFilePath)) {
            fs.unlinkSync(tempFilePath)
          }
        }

      } else if (text.startsWith('/ingest ')) {
        // --- NEW INGESTION LOGIC ---
        const ingestText = text.replace('/ingest ', '').trim()
        if (!ingestText) {
          await reply('Please provide the text you want me to learn. Example: /ingest The company was founded in 2026.')
          return NextResponse.json({ status: 'ok' }, { status: 200 })
        }

        const processingMsgId = await reply('🧠 <i>Processing new knowledge...</i>')

        try {
          let textToIngest = ingestText;
          let sourceType = 'text';
          let sourceName = 'Telegram Message';

          // Detect URLs (http, www, or common TLDs)
          const urlRegex = /(https?:\/\/[^\s]+)|(www\.[^\s]+)|([a-zA-Z0-9-]+\.(com|org|net|io|co|ai|app|dev)(\/[^\s]*)?)/i;
          const urlMatch = ingestText.match(urlRegex);

          if (urlMatch && urlMatch[0]) {
            const url = urlMatch[0];
            sourceName = url;
            sourceType = 'website';
            if (processingMsgId) await editReply(processingMsgId, `🌐 <i>Extracting knowledge from ${url}...</i>`);
            
            const scrapedText = await scrapeWebsite(url);
            textToIngest = `Website Context URL: ${url}\n\nWebsite Content:\n${scrapedText}\n\nOriginal User Request:\n${ingestText}`;
          }

          // 1. Log the source
          const { data: sourceData, error: sourceError } = await supabase
            .from('knowledge_sources')
            .insert([{ source_name: sourceName, source_type: sourceType, processing_status: 'PROCESSING' }])
            .select()
            .single()

          if (sourceError) throw sourceError

          // 2. Extract structured knowledge
          const structuredData = await processKnowledge(textToIngest)
          
          // 3. Generate Vector Embedding
          const embedding = await generateEmbedding(textToIngest)

          // 4. Store in Memory
          const { data: memoryData, error: memoryError } = await supabase
            .from('memory_entries')
            .insert([{ 
                title: structuredData.title,
                summary: structuredData.summary,
                category: structuredData.tags[0] || 'GENERAL',
                tags: structuredData.tags,
                content: { raw_text: textToIngest },
                source_type: sourceType,
                source_reference: sourceData.id,
                embedding: embedding
            }])
            .select()
            .single()

          if (memoryError) throw memoryError

          // 5. Update status
          await supabase
            .from('knowledge_sources')
            .update({ processing_status: 'COMPLETED', processed_at: new Date().toISOString() })
            .eq('id', sourceData.id)

          if (processingMsgId) {
            await editReply(processingMsgId, `✅ <b>Knowledge Ingested</b>\n\n<b>Title:</b> ${structuredData.title}\n<b>Tags:</b> ${structuredData.tags.join(', ')}`)
          }
        } catch (error: any) {
          console.error('Ingestion error:', error)
          if (processingMsgId) await editReply(processingMsgId, `❌ Error ingesting knowledge: ${error.message}`)
        }

      } else {
        // --- NEW RAG RETRIEVAL LOGIC ---
        // Treat any normal text as a query to the brain
        const thinkingMsgId = await reply('💭 <i>Searching memory...</i>')

        try {
          const queryEmbedding = await generateEmbedding(text)
          
          const { data: matchingMemories, error } = await supabase
            .rpc('match_memory_entries', {
              query_embedding: queryEmbedding,
              match_threshold: 0.5, 
              match_count: 5
            })

          if (error) throw error

          let contextStr = ''
          if (matchingMemories && matchingMemories.length > 0) {
            contextStr = matchingMemories
              .map((memory: any) => `[Source: ${memory.title}]\n${memory.content.raw_text}`)
              .join('\n\n')
          } else {
            if (thinkingMsgId) await editReply(thinkingMsgId, "I don't have any relevant information in my memory about that.")
            return NextResponse.json({ status: 'ok' }, { status: 200 })
          }

          const answer = await synthesizeAnswer(text, contextStr)

          if (thinkingMsgId) {
            await editReply(thinkingMsgId, answer)
          }

        } catch (error: any) {
          console.error('Retrieval error:', error)
          if (thinkingMsgId) await editReply(thinkingMsgId, `❌ Error retrieving information: ${error.message}`)
        }
      }
    }

    return NextResponse.json({ status: 'ok' }, { status: 200 })
  } catch (error) {
    console.error('Telegram webhook error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
