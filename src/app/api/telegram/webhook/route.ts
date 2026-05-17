import { createClient } from '@/utils/supabase/server'
import { NextResponse } from 'next/server'
import { sendTelegramMessage } from '@/utils/telegram'
import { generateEmbedding, processKnowledge, synthesizeAnswer, extractKnowledgeFromFile, brainstormIdea, parseTaskTime } from '@/ai/gemini'
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

          // 6. Handle Auto-Extracted Action Items
          let scheduledTasksText = ''
          if (structuredData.actionItems && structuredData.actionItems.length > 0) {
            for (const item of structuredData.actionItems) {
              const taskDesc = item.description
              // Default to 1 hour from now if no time is implied
              let eventTime = new Date()
              eventTime.setHours(eventTime.getHours() + 1)
              
              if (item.isoTimestamp) {
                eventTime = new Date(item.isoTimestamp)
              }
              
              const triggerTime = new Date(eventTime.getTime() - 30 * 60000)
              const endTime = new Date(eventTime.getTime() + 60 * 60000)

              await supabase.from('tasks').insert([{
                description: taskDesc,
                original_time: eventTime.toISOString(),
                end_time: endTime.toISOString(),
                trigger_time: triggerTime.toISOString(),
                is_completed: false
              }])
            }
            scheduledTasksText = `\n\n🎯 <b>Auto-Scheduled ${structuredData.actionItems.length} Action Items</b>`
          }

          if (processingMsgId) {
            await editReply(processingMsgId, `✅ <b>Knowledge Ingested</b>\n\n<b>Title:</b> ${structuredData.title}\n<b>Tags:</b> ${structuredData.tags.join(', ')}${scheduledTasksText}`)
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

          // 6. Handle Auto-Extracted Action Items
          let scheduledTasksText = ''
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
            }
            scheduledTasksText = `\n\n🎯 <b>Auto-Scheduled ${structuredData.actionItems.length} Action Items</b>`
          }

          if (processingMsgId) {
            await editReply(processingMsgId, `✅ <b>Knowledge Ingested</b>\n\n<b>Title:</b> ${structuredData.title}\n<b>Tags:</b> ${structuredData.tags.join(', ')}${scheduledTasksText}`)
          }
        } catch (error: any) {
          console.error('Ingestion error:', error)
          if (processingMsgId) await editReply(processingMsgId, `❌ Error ingesting knowledge: ${error.message}`)
        }

      } else if (text.startsWith('/reason ')) {
        // --- NEW REASONING LOGIC ---
        const ideaText = text.replace('/reason ', '').trim()
        if (!ideaText) {
          await reply('Please provide an idea to reason about. Example: /reason How should we market the new Architect unit?')
          return NextResponse.json({ status: 'ok' }, { status: 200 })
        }

        const thinkingMsgId = await reply('🧠 <i>Reasoning...</i>')

        try {
          // 1. Pull Context
          const queryEmbedding = await generateEmbedding(ideaText)
          const { data: matchingMemories, error: matchError } = await supabase
            .rpc('match_memory_entries', {
              query_embedding: queryEmbedding,
              match_threshold: 0.5, 
              match_count: 5
            })

          if (matchError) throw matchError

          let contextStr = ''
          if (matchingMemories && matchingMemories.length > 0) {
            contextStr = matchingMemories
              .map((memory: any) => `[Source: ${memory.title}]\n${memory.content.raw_text}`)
              .join('\n\n')
          }

          // 2. Brainstorm
          const answer = await brainstormIdea(ideaText, contextStr)

          if (thinkingMsgId) {
            await editReply(thinkingMsgId, answer)
          }

          // 3. Auto-Ingest the Conversation
          const sessionText = `Reasoning Session:\n\nJake's Prompt:\n${ideaText}\n\nThe Machine's Response:\n${answer}`
          
          const { data: sourceData, error: sourceError } = await supabase
            .from('knowledge_sources')
            .insert([{ source_name: 'Reasoning Session', source_type: 'reasoning_session', processing_status: 'PROCESSING' }])
            .select()
            .single()

          const structuredData = await processKnowledge(sessionText)
          const sessionEmbedding = await generateEmbedding(sessionText)

          await supabase
            .from('memory_entries')
            .insert([{ 
                title: structuredData.title,
                summary: structuredData.summary,
                category: 'REASONING_SESSION',
                tags: structuredData.tags,
                content: { raw_text: sessionText },
                source_type: 'reasoning_session',
                source_reference: sourceData?.id,
                embedding: sessionEmbedding
            }])

          if (sourceData) {
            await supabase
              .from('knowledge_sources')
              .update({ processing_status: 'COMPLETED', processed_at: new Date().toISOString() })
              .eq('id', sourceData.id)
          }

          // 4. Handle Auto-Extracted Action Items
          let scheduledTasksText = ''
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
            }
            scheduledTasksText = `\n\n🎯 <b>Auto-Scheduled ${structuredData.actionItems.length} Action Items</b>`
            if (thinkingMsgId) {
              // Send an extra message for action items since the main message was already sent
              await reply(scheduledTasksText)
            }
          }

        } catch (error: any) {
          console.error('Reasoning error:', error)
          if (thinkingMsgId) await editReply(thinkingMsgId, `❌ Error during reasoning: ${error.message}`)
        }

      } else if (text.startsWith('/task ')) {
        // --- NEW TASK SCHEDULING LOGIC ---
        const taskText = text.replace('/task ', '').trim()
        if (!taskText) {
          await reply('Please describe the task and time. Example: /task Meeting with dev at 4pm')
          return NextResponse.json({ status: 'ok' }, { status: 200 })
        }
        
        const thinkingMsgId = await reply('🕒 <i>Scheduling task...</i>')
        
        try {
          const nowLagos = new Date().toLocaleString('en-US', { timeZone: 'Africa/Lagos' })
          const parsed = await parseTaskTime(taskText, nowLagos)
          
          const eventTime = new Date(parsed.isoTimestamp)
          
          let endTime = new Date(eventTime.getTime() + 60 * 60000) // Default 1 hour
          if (parsed.isoEndTime) {
            endTime = new Date(parsed.isoEndTime)
          }

          // 30 minutes before
          const triggerTime = new Date(eventTime.getTime() - 30 * 60000)
          
          const { error } = await supabase.from('tasks').insert([{
            description: parsed.description,
            original_time: eventTime.toISOString(),
            end_time: endTime.toISOString(),
            trigger_time: triggerTime.toISOString(),
            is_completed: false
          }])
          
          if (error) throw error
          
          if (thinkingMsgId) {
            await editReply(thinkingMsgId, `✅ <b>Task Scheduled</b>\n\n<b>Description:</b> ${parsed.description}\n<b>Event Time:</b> ${eventTime.toLocaleString('en-US', { timeZone: 'Africa/Lagos' })}\n\nI will send you a Voice Note 30 minutes before.`)
          }
        } catch (err: any) {
          console.error('Task parsing error:', err)
          if (thinkingMsgId) await editReply(thinkingMsgId, `❌ Error scheduling task: ${err.message}`)
        }

      } else if (text.startsWith('/hunter ')) {
        // --- NEW HUNTER COMMAND FORWARDING ---
        const commandText = text.replace('/hunter ', '').trim()
        if (!commandText) {
          await reply('Please provide a command for Hunter. Example: /hunter start campaign for fintech')
          return NextResponse.json({ status: 'ok' }, { status: 200 })
        }

        const thinkingMsgId = await reply('📡 <i>Relaying command to Hunter Unit...</i>')

        try {
          const hunterUrl = process.env.HUNTER_URL
          const unitSecret = process.env.UNIT_SECRET_KEY

          if (!hunterUrl) {
            throw new Error('HUNTER_URL is not configured in environment variables.')
          }

          const response = await fetch(`${hunterUrl}/api/commands`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${unitSecret}`
            },
            body: JSON.stringify({
              command: commandText,
              admin_id: chatId
            })
          })

          if (!response.ok) {
            const errorData = await response.json().catch(() => ({}))
            throw new Error(errorData.message || `Hunter server returned ${response.status}`)
          }

          if (thinkingMsgId) {
            await editReply(thinkingMsgId, `🎯 <b>Command Relayed to Hunter</b>\n\n"${commandText}"\n\nHunter is now processing your request.`)
          }
        } catch (error: any) {
          console.error('Hunter Command error:', error)
          if (thinkingMsgId) await editReply(thinkingMsgId, `❌ Error relaying command to Hunter: ${error.message}`)
        }

      } else if (text === '/guide' || text === '/help') {
        const guideText = `
🤖 <b>The Machine - Official Guide</b>

Here is a list of all commands you can use to manage Khrien's operations:

<b>1. Memory & Knowledge</b>
• <code>/ingest &lt;text&gt;</code> - Memorize raw text, thoughts, or facts.
• <code>/ingest &lt;url&gt;</code> - Scrape and memorize a website.
• Send any <b>PDF, JPG, PNG, or MP4</b> with the caption <code>/ingest</code> - The Brain will extract the text/vision and memorize it.

<b>2. Strategy & Thinking</b>
• <code>/reason &lt;idea&gt;</code> - Brainstorm an idea. The Brain will pull relevant facts, challenge your idea, and automatically save the conclusion to its memory.
• <i>(Any normal text)</i> - Ask a question. The Brain will search its memory and answer you.

<b>3. Task Management</b>
• <code>/task &lt;description&gt; at &lt;time&gt;</code> - Schedule an event (e.g. <i>/task Meeting with dev at 4pm for 1 hr</i>).
• The Brain will send you an audio Voice Note 30 mins before it starts.
• When the meeting ends, it will ping you for a debrief.

<b>4. Multi-Agent Commands (Units)</b>
• <code>/hunter &lt;instruction&gt;</code> - Send a command directly to the Hunter Unit (e.g. <i>/hunter start campaign for SaaS founders</i>).

<b>5. Automation (Action Items)</b>
• Whenever you use <code>/ingest</code>, <code>/reason</code>, or forward an email, if you imply a promise or TODO (e.g. "I need to call him by 5pm"), The Brain will automatically extract and schedule it as a <code>/task</code>!
        `
        await reply(guideText)
        return NextResponse.json({ status: 'ok' }, { status: 200 })

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
