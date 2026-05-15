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
    "tags": ["TAG_1", "TAG_2"]
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
