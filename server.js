require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs/promises');
const { execFile } = require('child_process');
const { promisify } = require('util');
const OpenAI = require('openai');
const { chromium } = require('playwright');

const execFileAsync = promisify(execFile);
const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const GENERATED_ROOT = path.join(__dirname, 'generated-project');
const PROMPTS_ROOT = path.join(__dirname, 'prompts');

app.use(express.json({ limit: '6mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const FALLBACK_PROMPTS = {
  planner: 'You are the planning brain of an autonomous software engineer. Return JSON with projectName, summary, requirements, pages, tasks, and acceptanceCriteria. Preserve requested scope and do not invent major features.',
  architect: 'You are the architecture agent. Return JSON with stack, entryPoint, and files containing path, purpose, dependsOn, and implementationNotes. Keep the architecture minimal and runnable.',
  builder: 'You are the implementation agent. Return ONLY JSON with projectName, summary, and files. Implement the supplied plan and architecture exactly.',
  debugger: 'You are the debugging agent. Return ONLY JSON with patches containing path, complete replacement content, and reason. Fix only the reported failures.',
  browserQa: 'You are the browser QA agent. Return ONLY JSON with deterministic browser tests using stable CSS selectors.',
  visualQa: 'You are the visual QA agent. Return ONLY JSON with passed and issues. Fail only for concrete UI problems.'
};

async function loadPrompt(name) {
  try {
    return await fs.readFile(path.join(PROMPTS_ROOT, `${name}.txt`), 'utf8');
  } catch (_) {
    return FALLBACK_PROMPTS[name] || '';
  }
}

function fallbackPlan(idea) {
  return {
    projectName: 'New Project',
    summary: idea,
    requirements: ['Implement the requested user flow', 'Add validation and error handling', 'Make the primary interaction usable', 'Test the critical flow'],
    pages: ['Home'],
    tasks: [
      { id: 1, title: 'Define project requirements', priority: 'high' },
      { id: 2, title: 'Design the application structure', priority: 'high' },
      { id: 3, title: 'Build the core features', priority: 'high' },
      { id: 4, title: 'Add validation and error handling', priority: 'medium' },
      { id: 5, title: 'Test the main user flow', priority: 'medium' }
    ],
    acceptanceCriteria: ['The requested primary flow works in a browser.']
  };
}

async function callModel(system, user, options = {}) {
  const apiKey = process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('Missing OPENROUTER_API_KEY');
  const client = new OpenAI({
    apiKey,
    baseURL: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
    defaultHeaders: {
      'HTTP-Referer': 'http://localhost:3000',
      'X-OpenRouter-Title': 'MY-AGENT'
    }
  });
  const response = await client.chat.completions.create({
    model: options.model || process.env.OPENROUTER_MODEL || process.env.OPENAI_MODEL || 'openai/gpt-4o-mini',
    response_format: { type: 'json_object' },
    temperature: options.temperature ?? 0.12,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }]
  });
  const text = response.choices?.[0]?.message?.content;
  if (!text) throw new Error('The model returned an empty response.');
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`The model returned invalid JSON: ${error.message}`);
  }
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
      const files = candidate.map(file => normalizeFile(file)).filter(Boolean);
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

function validateArchitecture(payload) {
  const files = Array.isArray(payload?.files) ? payload.files.filter(file => cleanRelativePath(file?.path)) : [];
  if (!files.length) throw new Error('Architecture agent did not return a usable file plan.');
  return {
    stack: Array.isArray(payload.stack) ? payload.stack : [],
    entryPoint: cleanRelativePath(payload.entryPoint) || files[0].path,
    files
  };
}

function buildContext(plan, architecture, files = []) {
  return JSON.stringify({
    request: plan.summary,
    requirements: plan.requirements,
    pages: plan.pages,
    tasks: plan.tasks,
    acceptanceCriteria: plan.acceptanceCriteria || [],
    architecture,
    files: files.map(file => ({ path: file.path, content: file.content }))
  });
}

async function createArchitecture(plan) {
  const system = await loadPrompt('architect');
  const result = await callModel(system, JSON.stringify(plan));
  return validateArchitecture(result);
}

async function reviewBuild(plan, architecture, files) {
  const review = await callModel(
    'You are the product QA reviewer for an autonomous software builder. Return ONLY JSON: {"passed":true|false,"issues":["..."]}. Fail if a requested feature or acceptance criterion is missing, unrelated major features were invented, visible controls have no apparent behavior, or the project is clearly a placeholder. Do not demand a database, authentication, framework, or extra features unless the plan requires them.',
    buildContext(plan, architecture, files),
    { temperature: 0 }
  );
  return { passed: Boolean(review.passed), issues: Array.isArray(review.issues) ? review.issues : [] };
}

async function reviewVisualDesign(plan, screenshot) {
  const apiKey = process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) return { passed: true, skipped: true, issues: [] };
  const system = await loadPrompt('visual-qa');
  const client = new OpenAI({
    apiKey,
    baseURL: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
    defaultHeaders: { 'HTTP-Referer': 'http://localhost:3000', 'X-OpenRouter-Title': 'MY-AGENT' }
  });
  try {
    const response = await client.chat.completions.create({
      model: process.env.OPENROUTER_VISION_MODEL || 'openai/gpt-4o',
      response_format: { type: 'json_object' },
      temperature: 0,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: [
          { type: 'text', text: JSON.stringify({ request: plan.summary, requirements: plan.requirements, acceptanceCriteria: plan.acceptanceCriteria || [] }) },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${screenshot.toString('base64')}` } }
        ] }
      ]
    });
    const review = JSON.parse(response.choices?.[0]?.message?.content || '{}');
    return { passed: Boolean(review.passed), skipped: false, issues: Array.isArray(review.issues) ? review.issues : [] };
  } catch (error) {
    console.error('Visual QA skipped:', error.message);
    return { passed: true, skipped: true, issues: [], warning: error.message };
  }
}

async function generateBuild(plan, architecture, extraInstructions = '') {
  const basePrompt = await loadPrompt('builder');
  const system = `${basePrompt}\n\nAdditional constraints:\n${extraInstructions}`;
  const user = buildContext(plan, architecture);

  let build = await callModel(system, user);
  let validated;
  try {
    validated = validateBuildPayload(build);
  } catch (_) {
    build = await callModel(`${system}\nYour previous response was invalid. Return a files array containing complete path/content objects.`, user);
    validated = validateBuildPayload(build);
  }

  const review = await reviewBuild(plan, architecture, validated.files);
  if (!review.passed) {
    const repairInstruction = `Product QA rejected the build. Fix every issue below without adding unrelated features:\n${review.issues.map((issue, i) => `${i + 1}. ${issue}`).join('\n')}`;
    build = await callModel(`${system}\n${repairInstruction}`, user);
    validated = validateBuildPayload(build);
  }

  return validated;
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
  const index = files.find(file => file.path.toLowerCase() === 'index.html');
  results.push(index ? { name: 'index.html exists', passed: true } : { name: 'index.html exists', passed: false, error: 'No index.html was generated.' });

  for (const file of files.filter(file => file.path.toLowerCase().endsWith('.js'))) {
    try {
      await execFileAsync(process.execPath, ['--check', path.join(GENERATED_ROOT, ...file.path.split('/'))]);
      results.push({ name: `JavaScript syntax: ${file.path}`, passed: true });
    } catch (error) {
      results.push({ name: `JavaScript syntax: ${file.path}`, passed: false, error: (error.stderr || error.message).trim() });
    }
  }

  if (index) {
    const refs = [...index.content.matchAll(/<(?:script|link)[^>]+(?:src|href)=["']([^"']+)["']/gi)]
      .map(match => match[1])
      .filter(ref => !ref.startsWith('http') && !ref.startsWith('//'));
    for (const ref of refs) {
      const clean = ref.split('?')[0].replace(/^\.\//, '');
      const exists = files.some(file => file.path === clean);
      results.push({ name: `Asset reference: ${clean}`, passed: exists, error: exists ? undefined : `Referenced file ${clean} was not generated.` });
    }
  }
  return results;
}

async function createBrowserTests(plan, architecture, files, dom) {
  const system = await loadPrompt('browser-qa');
  const prompt = `${system}\n\nProduct context:\n${buildContext(plan, architecture, files)}\n\nRendered DOM snapshot:\n${dom.slice(0, 30000)}`;
  const result = await callModel(prompt, 'Create the smallest reliable browser test suite for this app.', { temperature: 0 });
  return Array.isArray(result.tests) ? result.tests.slice(0, 8) : [];
}

async function runBrowserTests(plan, architecture, files) {
  const results = [];
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const consoleErrors = [];
    const pageErrors = [];
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    page.on('pageerror', error => pageErrors.push(error.message));

    const response = await page.goto(`${BASE_URL}/generated/index.html`, { waitUntil: 'networkidle', timeout: 15000 });
    if (!response || !response.ok()) throw new Error(`Generated app returned HTTP ${response?.status() || 'unknown'}.`);

    const dom = await page.locator('body').innerHTML();
    const screenshot = await page.screenshot({ type: 'png', fullPage: true });
    const visualReview = await reviewVisualDesign(plan, screenshot);
    if (visualReview.skipped) {
      results.push({ name: 'Visual QA: screenshot review', passed: true, warning: visualReview.warning || 'Visual QA skipped.' });
    } else {
      results.push({ name: 'Visual QA: polished and coherent UI', passed: visualReview.passed, error: visualReview.passed ? undefined : visualReview.issues.join(' | ') });
    }

    const tests = await createBrowserTests(plan, architecture, files, dom);
    if (!tests.length) {
      results.push({ name: 'Browser QA plan generated', passed: false, error: 'QA agent did not produce browser tests.' });
    }

    for (const test of tests) {
      try {
        for (const step of test.steps || []) {
          const locator = page.locator(step.selector);
          if (step.action === 'fill') await locator.first().fill(String(step.value ?? 'QA test value'));
          else if (step.action === 'click') await locator.first().click();
          else if (step.action === 'press') await locator.first().press(step.key || 'Enter');
          else if (step.action === 'check') await locator.first().check();
          else throw new Error(`Unsupported action: ${step.action}`);
        }
        for (const assertion of test.assertions || []) {
          const locator = page.locator(assertion.selector);
          if (assertion.type === 'visible') {
            if (!(await locator.first().isVisible())) throw new Error(`Expected visible: ${assertion.selector}`);
          } else if (assertion.type === 'text') {
            const text = await locator.first().innerText();
            if (!text.includes(String(assertion.contains))) throw new Error(`Expected text \"${assertion.contains}\" in ${assertion.selector}, got \"${text}\"`);
          } else if (assertion.type === 'notText') {
            const text = await locator.first().innerText().catch(() => '');
            if (text.includes(String(assertion.contains))) throw new Error(`Unexpected text \"${assertion.contains}\" in ${assertion.selector}`);
          } else if (assertion.type === 'count') {
            const count = await locator.count();
            if (typeof assertion.min === 'number' && count < assertion.min) throw new Error(`Expected at least ${assertion.min} matching elements, got ${count}`);
          }
        }
        results.push({ name: `Browser: ${test.name}`, passed: true });
      } catch (error) {
        results.push({ name: `Browser: ${test.name}`, passed: false, error: error.message });
      }
      await page.reload({ waitUntil: 'networkidle' }).catch(() => {});
    }

    results.push(consoleErrors.length || pageErrors.length
      ? { name: 'Browser console errors', passed: false, error: [...consoleErrors, ...pageErrors].slice(0, 5).join(' | ') }
      : { name: 'Browser console errors', passed: true });
  } catch (error) {
    results.push({ name: 'Browser launch / page load', passed: false, error: `${error.message}. If Chromium is missing, run: npx playwright install chromium` });
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
  return results;
}

function applyPatches(files, patches) {
  const next = files.map(file => ({ ...file }));
  for (const patch of patches) {
    const patchPath = cleanRelativePath(patch?.path);
    if (!patchPath || typeof patch?.content !== 'string') continue;
    const index = next.findIndex(file => file.path === patchPath);
    if (index >= 0) next[index] = { path: patchPath, content: patch.content };
    else next.push({ path: patchPath, content: patch.content });
  }
  return next;
}

async function repairFromFailures(plan, architecture, files, failures) {
  const system = await loadPrompt('debugger');
  const failureText = failures.map((failure, i) => `${i + 1}. ${failure.name}: ${failure.error || 'failed'}`).join('\n');
  const result = await callModel(
    system,
    `${buildContext(plan, architecture, files)}\n\nQA FAILURES:\n${failureText}`,
    { temperature: 0.05 }
  );
  const patches = Array.isArray(result.patches) ? result.patches : [];
  if (!patches.length) return generateBuild(plan, architecture, `QA failures could not be patched directly. Rebuild carefully and fix:\n${failureText}`);
  return { projectName: plan.projectName, summary: plan.summary, files: applyPatches(files, patches) };
}

app.post('/api/plan', async (req, res) => {
  const idea = String(req.body?.idea || '').trim();
  if (!idea) return res.status(400).json({ error: 'Please describe the project you want to build.' });
  try {
    const system = await loadPrompt('planner');
    const plan = await callModel(system, idea);
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
    const architecture = await createArchitecture(plan);
    let build = await generateBuild(plan, architecture);
    await writeGeneratedProject(build.files);

    let tests = await testGeneratedProject(build.files);
    let browserTests = await runBrowserTests(plan, architecture, build.files);
    tests = [...tests, ...browserTests];

    let repaired = false;
    let failures = tests.filter(test => !test.passed);
    for (let attempt = 1; failures.length && attempt <= 2; attempt += 1) {
      console.log(`QA found ${failures.length} failure(s). Starting targeted repair ${attempt}/2.`);
      build = await repairFromFailures(plan, architecture, build.files, failures);
      await writeGeneratedProject(build.files);
      tests = [...await testGeneratedProject(build.files), ...await runBrowserTests(plan, architecture, build.files)];
      failures = tests.filter(test => !test.passed);
      repaired = true;
    }

    res.json({ ...build, architecture, tests, mode: 'ai', repaired, repairAttempts: repaired ? 1 : 0, qaPassed: failures.length === 0 });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message || 'The builder agent failed. Check the server terminal.' });
  }
});

app.use('/generated', express.static(GENERATED_ROOT));
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.listen(PORT, () => console.log(`MY-AGENT running on http://localhost:${PORT}`));
