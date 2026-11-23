import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { Pool } from 'pg';
import { GoogleGenerativeAI } from '@google/generative-ai';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 20,//max no. of clients in the pool
    idleTimeoutMillis: 30000, //close idle clients after 30 sec
    connectionTimeoutMillis: 2000,
});

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

function sanitizeLog(logText) {
    let cleaned = logText;
    cleaned = cleaned.replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[IP]');
    cleaned = cleaned.replace(/\b\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?\b/g, '[TIMESTAMP]');
    return cleaned;
}

app.post('/api/analyze-log', async (req, res) => {
    try {
        const { log_text } = req.body;

        if (!log_text) {
            return res.status(400).json({ error: "Missing 'log_text' in request body." });
        }
        console.log("\n[1/4] Received log. Sanitizing...");
        const cleanLog = sanitizeLog(log_text);

        // console.log(ModelService.ListModels);

        console.log("[2/4] Generating vector embedding for the log...");
        const embeddingModel = genAI.getGenerativeModel({ model: "text-embedding-004" });
        const embeddingResult = await embeddingModel.embedContent(cleanLog);
        const vectorArray = embeddingResult.embedding.values;
        const vectorString = JSON.stringify(vectorArray);
        console.log("[3/4] Searching database for relevant documentation...");
        const dbQuery = `
            SELECT content 
            FROM cloud_docs 
            ORDER BY embedding <=> $1 
            LIMIT 3;
        `;
        const { rows } = await pool.query(dbQuery, [vectorString]);
        
        const retrievedDocs = rows.map(row => row.content);
        const contextString = retrievedDocs.join('\n\n---\n\n');

        console.log("[4/4] Generating solution with Gemini 3.5 Flash...");
        const llmModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        
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

        console.log("Analysis complete. Returning response.");
        res.json({
            solution: finalAnswer,
            context_used: retrievedDocs
        });

    } catch (error){
        console.error("Error analyzing log:", error);
        res.status(500).json({ error: "An internal server error occurred during log analysis." });
    }
});

app.get('/',(req,res)=>{
    res.send('Cloud Log Analyzer API is running.');
});

app.listen(port,()=>{
    console.log(`Server listening at http://localhost:${port}`);
});