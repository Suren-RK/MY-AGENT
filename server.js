require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs/promises');
const { execFile } = require('child_process');
const { promisify } = require('util');
const OpenAI = require('openai');

const execFileAsync = promisify(execFile);
const app = express();
const PORT = process.env.PORT || 3000;
const GENERATED_ROOT = path.join(__dirname, 'generated-project');

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function fallbackPlan(idea) {
  return {
    projectName: 'New Project', summary: idea,
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

async function callModel(system, user) {
  const apiKey = process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('Missing OPENROUTER_API_KEY');
  const client = new OpenAI({
    apiKey,
    baseURL: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
    defaultHeaders: { 'HTTP-Referer': 'http://localhost:3000', 'X-OpenRouter-Title': 'MY-AGENT' }
  });
  const response = await client.chat.completions.create({
    model: process.env.OPENROUTER_MODEL || process.env.OPENAI_MODEL || 'openai/gpt-4o-mini',
    response_format: { type: 'json_object' }, temperature: 0.2,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }]
  });
  return JSON.parse(response.choices[0].message.content);
}

function cleanRelativePath(value) {
  const raw = String(value || '').replace(/\\/g, '/').trim();
  if (!raw || raw.startsWith('/') || raw.includes('..') || /^[A-Za-z]:/.test(raw)) return null;
  const normalized = path.posix.normalize(raw);
  if (normalized === '.' || normalized.startsWith('../')) return null;
  return normalized;
}

function validateBuildPayload(payload) {
  if (!payload || !Array.isArray(payload.files)) throw new Error('Builder did not return a files array.');
  const files = payload.files.map((file) => {
    const filePath = cleanRelativePath(file?.path);
    const content = typeof file?.content === 'string' ? file.content : null;
    if (!filePath || content === null) throw new Error('Builder returned an invalid file.');
    return { path: filePath, content };
  });
  if (!files.length) throw new Error('Builder returned no files.');
  return { projectName: String(payload.projectName || 'Generated Project').trim(), summary: String(payload.summary || '').trim(), files };
}

async function writeGeneratedProject(files) {
  await fs.rm(GENERATED_ROOT, { recursive: true, force: true });
  await fs.mkdir(GENERATED_ROOT, { recursive: true });
  for (const file of files) {
    const target = path.join(GENERATED_ROOT, ...file.path.split('/'));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, file.content, 'utf8');
  }
}

async function testGeneratedProject(files) {
  const results = [];
  const index = files.find(f => f.path.toLowerCase() === 'index.html');
  if (index) results.push({ name: 'index.html exists', passed: true });
  else results.push({ name: 'index.html exists', passed: false, error: 'No index.html was generated.' });

  const jsFiles = files.filter(f => f.path.toLowerCase().endsWith('.js'));
  for (const file of jsFiles) {
    try {
      await execFileAsync(process.execPath, ['--check', path.join(GENERATED_ROOT, ...file.path.split('/'))]);
      results.push({ name: `JavaScript syntax: ${file.path}`, passed: true });
    } catch (error) {
      results.push({ name: `JavaScript syntax: ${file.path}`, passed: false, error: (error.stderr || error.message).trim() });
    }
  }

  if (index) {
    const refs = [...index.content.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map(m => m[1]);
    for (const ref of refs) {
      const clean = ref.split('?')[0].replace(/^\.\//, '');
      const exists = files.some(f => f.path === clean);
      results.push({ name: `Script reference: ${clean}`, passed: exists, error: exists ? undefined : `Referenced file ${clean} was not generated.` });
    }
  }

  return results;
}

app.post('/api/plan', async (req, res) => {
  const idea = String(req.body?.idea || '').trim();
  if (!idea) return res.status(400).json({ error: 'Please describe the project you want to build.' });
  try {
    const plan = await callModel(
      'You are the planning brain of an autonomous software engineer. Convert a vague app idea into a practical build plan. Return JSON with projectName, summary, requirements (array of strings), pages (array of strings), and tasks (array of objects with id, title, priority where priority is high, medium, or low). Keep the plan concrete and implementation-ready.', idea
    );
    res.json({ ...plan, mode: 'ai' });
  } catch (error) {
    console.error(error);
    if (!process.env.OPENROUTER_API_KEY && !process.env.OPENAI_API_KEY) return res.json({ ...fallbackPlan(idea), mode: 'fallback' });
    res.status(500).json({ error: 'The planning agent failed. Check the server terminal for the OpenRouter error.' });
  }
});

app.post('/api/build', async (req, res) => {
  const plan = req.body?.plan;
  if (!plan || !Array.isArray(plan.tasks) || !plan.tasks.length) return res.status(400).json({ error: 'A valid build plan is required.' });
  try {
    const build = await callModel(
      'You are the builder agent of an autonomous software engineer. Generate a coherent small runnable MVP from this plan. Return JSON with projectName, summary, and files. Each file must have a safe relative path and complete text content. Prefer plain HTML/CSS/JavaScript when a framework is not required. Make sure index.html references generated JS/CSS files correctly.',
      JSON.stringify({ projectName: plan.projectName, summary: plan.summary, requirements: plan.requirements, pages: plan.pages, tasks: plan.tasks })
    );
    const validated = validateBuildPayload(build);
    await writeGeneratedProject(validated.files);
    const tests = await testGeneratedProject(validated.files);
    res.json({ ...validated, tests, mode: 'ai' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message || 'The builder agent failed. Check the server terminal.' });
  }
});

app.use('/generated', express.static(GENERATED_ROOT));

app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.listen(PORT, () => console.log(`MY-AGENT running on http://localhost:${PORT}`));
