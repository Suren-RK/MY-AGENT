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

app.use(express.json({ limit: '2mb' }));
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
    response_format: { type: 'json_object' },
    temperature: 0.2,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }]
  });
  const text = response.choices?.[0]?.message?.content;
  if (!text) throw new Error('The model returned an empty response.');
  return JSON.parse(text);
}

function cleanRelativePath(value) {
  const raw = String(value || '').replace(/\\/g, '/').trim();
  if (!raw || raw.startsWith('/') || raw.includes('..') || /^[A-Za-z]:/.test(raw)) return null;
  const normalized = path.posix.normalize(raw);
  if (normalized === '.' || normalized.startsWith('../')) return null;
  return normalized;
}

function normalizeFile(file, fallbackPath) {
  if (!file) return null;
  if (typeof file === 'string') return fallbackPath ? { path: fallbackPath, content: file } : null;
  const filePath = cleanRelativePath(file.path || file.filePath || file.filename || file.name);
  const content = typeof file.content === 'string' ? file.content : typeof file.code === 'string' ? file.code : typeof file.source === 'string' ? file.source : null;
  if (!filePath || content === null) return null;
  return { path: filePath, content };
}

function extractFiles(payload) {
  if (!payload || typeof payload !== 'object') return [];
  const candidates = [payload.files, payload.generatedFiles, payload.projectFiles, payload.fileList, payload.output?.files, payload.project?.files];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      const files = candidate.map((file) => normalizeFile(file)).filter(Boolean);
      if (files.length) return files;
    }
    if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
      const files = Object.entries(candidate).map(([filePath, value]) => normalizeFile(value, filePath)).filter(Boolean);
      if (files.length) return files;
    }
  }
  return [];
}

function validateBuildPayload(payload) {
  const files = extractFiles(payload);
  if (!files.length) throw new Error('Builder did not return usable project files.');
  return {
    projectName: String(payload.projectName || payload.name || payload.project?.name || 'Generated Project').trim(),
    summary: String(payload.summary || payload.description || payload.project?.summary || '').trim(),
    files
  };
}

async function generateBuild(plan) {
  const system = `You are the builder agent of an autonomous software engineer. Generate a coherent small runnable MVP from the supplied plan. Return ONLY valid JSON. The JSON must contain projectName, summary, and files. files MUST be an array. Every item must be {"path":"relative/path.ext","content":"complete file text"}. Never use markdown fences. Never omit file contents. For a basic web app, include index.html, a JavaScript file, and a CSS file when appropriate. Make sure HTML references match the generated paths.`;
  const user = JSON.stringify({ projectName: plan.projectName, summary: plan.summary, requirements: plan.requirements, pages: plan.pages, tasks: plan.tasks });

  let build = await callModel(system, user);
  try {
    return validateBuildPayload(build);
  } catch (firstError) {
    console.warn('Builder response did not match schema. Retrying with a stricter prompt.');
    build = await callModel(system + '\nIMPORTANT: Your previous response was invalid. This time return a files array with complete path/content objects and nothing else.', user);
    return validateBuildPayload(build);
  }
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
  results.push(index
    ? { name: 'index.html exists', passed: true }
    : { name: 'index.html exists', passed: false, error: 'No index.html was generated.' });

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
      'You are the planning brain of an autonomous software engineer. Convert a vague app idea into a practical build plan. Return JSON with projectName, summary, requirements (array of strings), pages (array of strings), and tasks (array of objects with id, title, priority where priority is high, medium, or low). Keep the plan concrete and implementation-ready.',
      idea
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
    const validated = await generateBuild(plan);
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
