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

app.use(express.json({ limit: '4mb' }));
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
    temperature: 0.15,
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

function buildContext(plan, files) {
  return JSON.stringify({
    request: plan.summary,
    requirements: plan.requirements,
    pages: plan.pages,
    tasks: plan.tasks,
    files: files.map(f => ({ path: f.path, content: f.content }))
  });
}

async function reviewBuild(plan, files) {
  const review = await callModel(
    `You are the QA reviewer for an autonomous software builder. Review the generated project against the user's requested app and its requirements. Return ONLY JSON: {"passed":true|false,"issues":["..."]}. Mark passed=false if a requested feature is missing, non-functional-looking, replaced by unrelated placeholder features, or if the UI adds major invented features the user did not ask for. For a simple app, require the requested core interactions to actually have UI controls and JavaScript behavior. Do not demand a database, authentication, framework, or extra features unless the request requires them.`,
    buildContext(plan, files)
  );
  return { passed: Boolean(review.passed), issues: Array.isArray(review.issues) ? review.issues : [] };
}

async function generateBuild(plan) {
  const system = `You are the builder agent of an autonomous software engineer.
Generate a coherent, runnable MVP that directly implements the user's request.
STRICT PRODUCT RULES:
1. Implement every explicitly requested feature.
2. Do NOT invent major features, screens, authentication, login/signup, payments, dashboards, or backend behavior unless the user requested them.
3. Do not replace the requested app with a generic template.
4. Every visible button must have a real purpose and working behavior.
5. For a simple web app, prefer plain HTML/CSS/JavaScript unless the plan explicitly requires a framework.
6. Keep the MVP focused and small.
7. Return ONLY valid JSON with projectName, summary, and files.
8. files MUST be an array of {"path":"relative/path.ext","content":"complete file text"}.
9. Never use markdown fences and never omit file contents.
10. index.html must reference the exact generated JS/CSS paths.
11. Make the app usable immediately after opening index.html; do not require fake login or setup steps unless requested.`;
  const user = JSON.stringify({ projectName: plan.projectName, summary: plan.summary, requirements: plan.requirements, pages: plan.pages, tasks: plan.tasks });

  let build = await callModel(system, user);
  let validated;
  try {
    validated = validateBuildPayload(build);
  } catch (firstError) {
    console.warn('Builder schema mismatch. Retrying.');
    build = await callModel(system + '\nIMPORTANT: Your previous response was invalid. Return a files array with complete path/content objects.', user);
    validated = validateBuildPayload(build);
  }

  let review = await reviewBuild(plan, validated.files);
  if (!review.passed) {
    console.warn('QA rejected first build:', review.issues);
    const repairPrompt = `${system}\n\nQA REJECTION: The previous build failed these checks:\n${review.issues.map((x, i) => `${i + 1}. ${x}`).join('\n')}\nRegenerate the project and fix every listed issue. Do not add unrelated features.`;
    build = await callModel(repairPrompt, user);
    validated = validateBuildPayload(build);
    review = await reviewBuild(plan, validated.files);
  }

  return { ...validated, review };
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
  results.push(index ? { name: 'index.html exists', passed: true } : { name: 'index.html exists', passed: false, error: 'No index.html was generated.' });

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
    const refs = [...index.content.matchAll(/<(?:script|link)[^>]+(?:src|href)=["']([^"']+)["']/gi)].map(m => m[1]).filter(ref => !ref.startsWith('http') && !ref.startsWith('//'));
    for (const ref of refs) {
      const clean = ref.split('?')[0].replace(/^\.\//, '');
      const exists = files.some(f => f.path === clean);
      results.push({ name: `Asset reference: ${clean}`, passed: exists, error: exists ? undefined : `Referenced file ${clean} was not generated.` });
    }
  }
  return results;
}

app.post('/api/plan', async (req, res) => {
  const idea = String(req.body?.idea || '').trim();
  if (!idea) return res.status(400).json({ error: 'Please describe the project you want to build.' });
  try {
    const plan = await callModel(
      'You are the planning brain of an autonomous software engineer. Convert the user idea into a concrete implementation plan. Do not invent major features. Return JSON with projectName, summary, requirements (array of strings), pages (array of strings), and tasks (array of objects with id, title, priority where priority is high, medium, or low). Requirements must explicitly cover every feature the user asked for.',
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
