require('dotenv').config();
const express = require('express');
const path = require('path');
const OpenAI = require('openai');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function fallbackPlan(idea) {
  return {
    projectName: 'New Project',
    summary: idea,
    requirements: ['Clarify the core user flow', 'Define the main data model', 'Build the primary user experience', 'Add validation and error handling', 'Test the critical flows'],
    pages: ['Home', 'Dashboard'],
    tasks: [
      { id: 1, title: 'Define project requirements', priority: 'high' },
      { id: 2, title: 'Design the application structure', priority: 'high' },
      { id: 3, title: 'Build the core features', priority: 'high' },
      { id: 4, title: 'Add validation and error handling', priority: 'medium' },
      { id: 5, title: 'Test the main user flows', priority: 'medium' },
      { id: 6, title: 'Prepare documentation', priority: 'low' }
    ]
  };
}

app.post('/api/plan', async (req, res) => {
  const idea = String(req.body?.idea || '').trim();
  if (!idea) return res.status(400).json({ error: 'Please describe the project you want to build.' });

  if (!process.env.OPENAI_API_KEY) {
    return res.json({ ...fallbackPlan(idea), mode: 'fallback' });
  }

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: 'You are the planning brain of an autonomous software engineer. Convert a vague app idea into a practical build plan. Return JSON with projectName, summary, requirements (array of strings), pages (array of strings), and tasks (array of objects with id, title, priority where priority is high, medium, or low). Keep the plan concrete and implementation-ready.'
        },
        { role: 'user', content: idea }
      ]
    });

    const plan = JSON.parse(response.choices[0].message.content);
    res.json({ ...plan, mode: 'ai' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'The planning agent failed. Try again.' });
  }
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`MY-AGENT running on http://localhost:${PORT}`));
