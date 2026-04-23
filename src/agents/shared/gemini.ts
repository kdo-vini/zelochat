import { GoogleGenAI } from '@google/genai';

export const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
export const GEMINI_MODEL = 'gemini-2.0-flash';
