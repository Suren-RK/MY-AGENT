require("dotenv").config();

const OpenAI = require("openai");

const client = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: "https://api.groq.com/openai/v1"
});

async function main() {
  if (!process.env.GROQ_API_KEY) {
    throw new Error("GROQ_API_KEY is missing. Add it to your local .env file.");
  }

  const response = await client.chat.completions.create({
    model: "openai/gpt-oss-120b",
    messages: [
      {
        role: "user",
        content: "Say hello and tell me you are working."
      }
    ]
  });

  console.log(response.choices[0].message.content);
}

main().catch((error) => {
  console.error("Groq test failed:");
  console.error(error.message || error);
  process.exit(1);
});
