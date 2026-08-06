import dotenv from 'dotenv';
import { Pool } from 'pg';
import { GoogleGenerativeAI } from '@google/generative-ai';

dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

function sanitizeLog(logText) {
  let cleaned = logText;
  cleaned = cleaned.replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[IP]');
  cleaned = cleaned.replace(/\b\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?\b/g, '[TIMESTAMP]');
  return cleaned;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  if (!process.env.GOOGLE_API_KEY || !process.env.DATABASE_URL) {
    res.status(500).json({
      error: 'Missing environment variables. Set GOOGLE_API_KEY and DATABASE_URL in Vercel project settings.'
    });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      body = {};
    }
  }

  const { log_text } = body || {};

  if (!log_text) {
    res.status(400).json({ error: "Missing 'log_text' in request body." });
    return;
  }

  try {
    const cleanLog = sanitizeLog(log_text);

    const embeddingModel = genAI.getGenerativeModel({ model: 'gemini-embedding-2' });
    const embeddingResult = await embeddingModel.embedContent(cleanLog);
    const vectorString = JSON.stringify(embeddingResult.embedding.values);

    const dbQuery = `
      SELECT content
      FROM cloud_docs
      ORDER BY embedding <=> $1
      LIMIT 3;
    `;
    const { rows } = await pool.query(dbQuery, [vectorString]);
    const retrievedDocs = rows.map((row) => row.content);
    const contextString = retrievedDocs.join('\n\n---\n\n');

    const llmModel = genAI.getGenerativeModel({ model: 'gemini-3.5-flash' });
    const prompt = `
You are a senior DevOps engineer troubleshooting server infrastructure.
Analyze the following server error log.

Use ONLY the provided "Context" documentation to explain the root cause of the error.
Provide a clear, step-by-step solution, including any necessary bash commands.
If the provided context does not contain the answer, say "Based on the internal documentation, I cannot determine the exact cause."

Context:
${contextString}

Error Log:
${log_text}
    `;

    const response = await llmModel.generateContent(prompt);
    const finalAnswer = response.response.text();

    res.status(200).json({
      solution: finalAnswer,
      context_used: retrievedDocs
    });
  } catch (error) {
    console.error('Error analyzing log:', error);
    res.status(500).json({ error: 'An internal server error occurred during log analysis.' });
  }
}
