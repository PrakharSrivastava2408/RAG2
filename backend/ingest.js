import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { fileURLToPath } from 'url';
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";

const __filename = fileURLToPath(import.meta.url);
// console.log("Current file path:", __filename);
const __dirname = path.dirname(__filename);

dotenv.config();

// console.log("MY KEY IS:", process.env.GOOGLE_API_KEY);
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false } 
});

// const loader = new PDFLoader("data/book.pdf");
// const docs = await loader.load();
// console.log({ docs });

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

function chunkText(text, maxChunkSize = 1000){
    const paragraphs = text.split(/\n\s*\n/);
    const chunks = [];
    let currentChunk = "";

    for (const paragraph of paragraphs){
        const cleanParagraph = paragraph.trim();
        if (!cleanParagraph) continue;
        if (currentChunk.length + cleanParagraph.length > maxChunkSize && currentChunk.length > 0) {
            chunks.push(currentChunk.trim());
            currentChunk = "";
        }
        currentChunk += cleanParagraph + "\n\n";
    }
    if (currentChunk.trim().length>0){
        chunks.push(currentChunk.trim());
    }

    return chunks;
}

async function generateEmbedding(text) {
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-embedding-2" });
        const result = await model.embedContent(text);
        return result.embedding.values;
    } catch (error) {
        console.error("Error generating embedding from Gemini:", error);
        throw error;
    }
}

/**
 * Main function to read files, chunk them, embed them, and insert into the database.
 */
async function ingestData() {
    // console.log(__dirname);
    const dataDirectory = path.join(__dirname, 'data');
    // console.log(dataDirectory);
    // Ensure the data directory exists
    if (!fs.existsSync(dataDirectory)) {
        console.error(`Please create a directory named 'data' at ${dataDirectory} and add some markdown files.`);
        process.exit(1);
    }

    const files = fs.readdirSync(dataDirectory).filter(file => file.endsWith('.md') || file.endsWith('.txt'));

    if (files.length === 0) {
        console.log("No .md or .txt files found in the data directory.");
        process.exit(0);
    }

    console.log(`Found ${files.length} files. Starting ingestion...`);

    try {
        for (const file of files) {
            console.log(`\nProcessing file: ${file}`);
            const filePath = path.join(dataDirectory, file);
            const fileContent = fs.readFileSync(filePath, 'utf-8');
            
            const chunks = chunkText(fileContent);
            console.log(`Generated ${chunks.length} chunks for ${file}.`);

            for (let i = 0; i < chunks.length; i++) {
                const chunk = chunks[i];
                console.log(`  -> Generating embedding for chunk ${i + 1}/${chunks.length}...`);
                
                const embedding = await generateEmbedding(chunk);
                const embeddingString = JSON.stringify(embedding);

                await pool.query(
                    `INSERT INTO cloud_docs (content, embedding) VALUES ($1, $2)`,
                    [chunk, embeddingString]
                );

                console.log(`  -> Chunk ${i + 1} saved to database successfully.`);
                
                await new Promise(resolve => setTimeout(resolve, 500)); 
            }
        }
        
        console.log("\n✅ All data successfully ingested into the vector database!");

    } catch (error) {
        console.error("❌ An error occurred during ingestion:", error);
    } finally {
        await pool.end();
    }
}

await ingestData();

// const text = "This is paragraph one.\n \nThis is paragraph two.";

// const paragraphs = text.split(/\n\s*\n/);

// console.log(paragraphs);