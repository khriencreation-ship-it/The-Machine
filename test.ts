import { GoogleGenAI } from '@google/genai';
const ai = new GoogleGenAI({});
ai.files.upload({ file: 'path', config: { mimeType: 'text/plain' } });
