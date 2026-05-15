"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var genai_1 = require("@google/genai");
var ai = new genai_1.GoogleGenAI({});
ai.files.upload({ file: 'path', config: { mimeType: 'text/plain' } });
