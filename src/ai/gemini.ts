import { GoogleGenAI } from '@google/genai'

// Initialize the SDK - it automatically picks up GEMINI_API_KEY from environment
const ai = new GoogleGenAI({})

export async function generateEmbedding(text: string) {
  const response = await ai.models.embedContent({
    model: 'gemini-embedding-2',
    contents: text,
  })
  
  if (!response.embeddings || response.embeddings.length === 0) {
    throw new Error('Failed to generate embedding')
  }
  
  return response.embeddings[0].values
}

export async function processKnowledge(text: string) {
  const prompt = `
  You are an expert organizational intelligence system. Analyze the following text and extract structured information.
  Identify the main title, a concise 2-sentence summary, and 3-5 relevant category tags (e.g. COMPANY_OVERVIEW, SERVICES, CORE_VALUES, PRICING, CASE_STUDIES).
  
  Respond ONLY with a valid JSON object in this exact format:
  {
    "title": "Document Title",
    "summary": "Concise summary...",
    "tags": ["TAG_1", "TAG_2"],
    "actionItems": [
      {
        "description": "Short description of the implied task or promise",
        "isoTimestamp": "Absolute ISO 8601 string if a deadline or time is implied, otherwise null"
      }
    ]
  }
  
  TEXT TO ANALYZE:
  ${text}
  `

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: prompt,
    config: {
      responseMimeType: "application/json",
    }
  })
  
  if (!response.text) throw new Error("Gemini returned empty response")
  
  return JSON.parse(response.text)
}

export async function synthesizeAnswer(query: string, context: string) {
  const prompt = `
  You are "The Machine", the intelligent organizational brain for Khrien.
  You are speaking directly with your creator and admin, Jake. Always refer to him by name.
  
  PERSONALITY:
  - You are a highly capable, autonomous AI partner.
  - Adapt your tone: If Jake's query is casual or quick, be chill, concise, and conversational. If the query is strategic or clearly "work mode", be highly analytical, serious, and professional.
  - You have a quiet confidence. You do not over-apologize. You exist to make Khrien unstoppable.
  
  CORE BUSINESS MODEL:
  Khrien operates on a dual model:
  1. Internal Projects: Building proprietary products and R&D.
  2. External Client Projects: Acting as an agency to take on external client work. Other units in Khrien are actively working to acquire and deliver for external clients.
  You must always keep both models in mind.

  RULES:
  - Answer Jake's query using ONLY the provided CONTEXT from your memory.
  - If the answer is not in the context, simply state that you don't have that in your memory yet. Do not hallucinate.
  
  CONTEXT:
  ${context}
  
  JAKE'S QUERY:
  ${query}
  `

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: prompt,
  })
  
  if (!response.text) throw new Error("Gemini returned empty response")
  
  return response.text
}

export async function extractKnowledgeFromFile(filePath: string, mimeType: string) {
  let uploadResult = null;
  try {
    // 1. Upload to Gemini
    uploadResult = await ai.files.upload({
      file: filePath,
      config: { mimeType: mimeType },
    });

    const prompt = `
    You are an expert data extraction AI. Analyze this file in detail.
    Extract all meaningful text, data, core concepts, and context from it.
    If it is an image or video, describe what is happening and extract any visible text.
    Return a comprehensive, highly-detailed text summary so I can memorize it for long-term retrieval.
    `;

    // 2. Generate content
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [
        {
          role: 'user',
          parts: [
            { fileData: { fileUri: uploadResult.uri, mimeType: uploadResult.mimeType } },
            { text: prompt }
          ]
        }
      ]
    });

    if (!response.text) throw new Error("Gemini returned empty response for file extraction.");
    
    return response.text;
  } finally {
    // 3. Always clean up the file from Google's servers
    if (uploadResult && uploadResult.name) {
      try {
        await ai.files.delete({ name: uploadResult.name });
      } catch (err) {
        console.error("Failed to delete file from Gemini:", err);
      }
    }
  }
}

export async function brainstormIdea(idea: string, context: string) {
  const prompt = `
  You are "The Machine", the intelligent organizational brain for Khrien.
  You are having a reasoning and brainstorming session with your creator and admin, Jake.
  
  PERSONALITY:
  - You are a highly strategic, visionary sounding board.
  - Do not just agree with him. Challenge his ideas constructively, expand on his concepts, and point out blind spots.
  - Pull heavily from the provided CONTEXT to connect his new idea with past facts or past reasoning sessions.
  - Speak in a collaborative, professional, and intellectually stimulating tone.

  CORE BUSINESS MODEL:
  Khrien operates on a dual model:
  1. Internal Projects: Building proprietary products and R&D.
  2. External Client Projects: Acting as an agency to take on external client work. Other units in Khrien are actively working to acquire and deliver for external clients.
  Actively consider client acquisition, client delivery, and external revenue when brainstorming.
  
  CONTEXT (Facts and Past Reasoning):
  ${context}
  
  JAKE'S NEW IDEA/CONCEPT:
  ${idea}
  `

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: prompt,
  })
  
  if (!response.text) throw new Error("Gemini returned empty response for brainstorming.")
  
  return response.text
}

export async function parseTaskTime(taskString: string, currentIsoTime: string) {
  const prompt = `
  You are an expert scheduling assistant. 
  The current local time for the user is: ${currentIsoTime}
  The user's timezone is Africa/Lagos (GMT+1).

  Parse the following task request and determine the exact future date and time for the event.
  Return a valid JSON object matching exactly this schema:
  {
    "description": "Short, clear description of the task",
    "isoTimestamp": "The absolute ISO 8601 string of the event start time",
    "isoEndTime": "The absolute ISO 8601 string of the event end time. If not specified, default to 1 hour after start time."
  }
  
  TASK REQUEST:
  ${taskString}
  `

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: prompt,
    config: {
      responseMimeType: "application/json",
    }
  })
  
  if (!response.text) throw new Error("Gemini returned empty response for parsing task.")
  
  const parsed = JSON.parse(response.text)
  if (!parsed.isoTimestamp) throw new Error("Could not determine a valid time for the task.")
  
  return parsed
}

export async function generateMorningBriefing(tasks: any[], recentMemories: any[]) {
  const prompt = `
  You are "The Machine", the intelligent organizational brain and Chief of Staff for Khrien.
  It is 7:00 AM in Lagos. Write a highly strategic, motivating Morning Briefing for your admin, Jake.
  
  Remember that Khrien manages both internal proprietary projects and external client projects.

  TODAY'S SCHEDULE:
  ${tasks.length === 0 ? "No tasks scheduled for today." : tasks.map(t => `- ${t.description} (at ${new Date(t.original_time).toLocaleTimeString('en-US', { timeZone: 'Africa/Lagos' })})`).join('\n')}

  YESTERDAY'S KNOWLEDGE / PROGRESS:
  ${recentMemories.length === 0 ? "No new knowledge ingested yesterday." : recentMemories.map(m => `- [${m.category}] ${m.title}: ${m.summary}`).join('\n')}

  Write a concise, professional, yet energetic briefing. Summarize what he needs to focus on today and gently remind him of the progress made yesterday.
  `

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: prompt,
  })
  
  if (!response.text) throw new Error("Gemini returned empty response for morning briefing.")
  
  return response.text
}
