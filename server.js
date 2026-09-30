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

app.use(express.json({ limit: '4mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function fallbackPlan(idea) {
  return {
    projectName: 'New Project', summary: idea,
    requirements: ['Clarify the core user flow', 'Define the main data model', 'Build the primary user experience', 'Add validation and error handling', 'Test the critical flows'],
    pages: ['Home'],
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
    temperature: 0.12,
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

function buildContext(plan, files) {
  return JSON.stringify({
    request: plan.summary,
    requirements: plan.requirements,
    pages: plan.pages,
    tasks: plan.tasks,
    files: files.map(file => ({ path: file.path, content: file.content }))
  });
}

async function reviewBuild(plan, files) {
  const review = await callModel(
    'You are the QA reviewer for an autonomous software builder. Review the generated project against the user request. Return ONLY JSON: {"passed":true|false,"issues":["..."]}. Fail if a requested feature is missing, unrelated major features were invented, visible controls have no apparent behavior, or the project is clearly a placeholder. For simple apps, keep scope focused. Do not demand a database, authentication, framework, or extra features unless requested.',
    buildContext(plan, files)
  );
  return { passed: Boolean(review.passed), issues: Array.isArray(review.issues) ? review.issues : [] };
}

async function generateBuild(plan, extraInstructions = '') {
  const system = `You are the builder agent of an autonomous software engineer.
Generate a coherent, runnable MVP that directly implements the user's request.
STRICT PRODUCT RULES:
1. Implement every explicitly requested feature.
2. Do NOT invent major features, screens, authentication, login/signup, payments, dashboards, or backend behavior unless the user requested them.
3. Do not replace the requested app with a generic template.
4. Every visible button must have a real purpose and working behavior.
5. For a simple web app, prefer plain HTML/CSS/JavaScript.
6. Keep the MVP focused and visually polished enough to be immediately usable.
7. Return ONLY valid JSON with projectName, summary, and files.
8. files MUST be an array of {"path":"relative/path.ext","content":"complete file text"}.
9. Never use markdown fences and never omit file contents.
10. index.html must reference exact generated JS/CSS paths.
11. Make the app usable immediately after opening index.html; do not require fake login or setup steps unless requested.
12. Do not put fake sample data into the main interaction unless it helps demonstrate the requested feature and is clearly harmless.
${extraInstructions}`;
  const user = JSON.stringify({ projectName: plan.projectName, summary: plan.summary, requirements: plan.requirements, pages: plan.pages, tasks: plan.tasks });

  let build = await callModel(system, user);
  let validated;
  try {
    validated = validateBuildPayload(build);
  } catch (_) {
    build = await callModel(system + '\nIMPORTANT: Your previous response was invalid. Return a files array containing complete path/content objects.', user);
    validated = validateBuildPayload(build);
  }

  const review = await reviewBuild(plan, validated.files);
  if (!review.passed) {
    const repair = `${system}\n\nQA REJECTION:\n${review.issues.map((issue, i) => `${i + 1}. ${issue}`).join('\n')}\nRegenerate the project and fix every issue. Do not add unrelated features.`;
    build = await callModel(repair, user);
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
    const refs = [...index.content.matchAll(/<(?:script|link)[^>]+(?:src|href)=["']([^"']+)["']/gi)].map(match => match[1]).filter(ref => !ref.startsWith('http') && !ref.startsWith('//'));
    for (const ref of refs) {
      const clean = ref.split('?')[0].replace(/^\.\//, '');
      const exists = files.some(file => file.path === clean);
      results.push({ name: `Asset reference: ${clean}`, passed: exists, error: exists ? undefined : `Referenced file ${clean} was not generated.` });
    }
  }
  return results;
}

async function createBrowserTests(plan, files, dom) {
  const prompt = `You are an end-to-end QA engineer. Create a small browser test plan for the generated web app.
Return ONLY JSON: {"tests":[{"name":"...","steps":[...],"assertions":[...]}]}.
Allowed step actions:
- {"action":"fill","selector":"CSS SELECTOR","value":"..."}
- {"action":"click","selector":"CSS SELECTOR"}
- {"action":"press","selector":"CSS SELECTOR","key":"Enter"}
- {"action":"check","selector":"CSS SELECTOR"}
Allowed assertions:
- {"type":"visible","selector":"CSS SELECTOR"}
- {"type":"text","selector":"CSS SELECTOR","contains":"TEXT"}
- {"type":"count","selector":"CSS SELECTOR","min":NUMBER}
- {"type":"notText","selector":"CSS SELECTOR","contains":"TEXT"}
Create tests that exercise the user's explicitly requested interactions. Prefer selectors using IDs, names, placeholders, button text via CSS :has-text(), or other stable attributes visible in the DOM. Do not use XPath. Do not invent selectors that are absent from the DOM.
User plan and requirements:\n${buildContext(plan, files)}\n\nRendered DOM snapshot:\n${dom.slice(0, 30000)}`;
  const result = await callModel('Generate reliable browser tests from the provided DOM and requirements.', prompt);
  return Array.isArray(result.tests) ? result.tests.slice(0, 8) : [];
}

async function runBrowserTests(plan, files) {
  const results = [];
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    const consoleErrors = [];
    const pageErrors = [];
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    page.on('pageerror', error => pageErrors.push(error.message));

    const response = await page.goto(`${BASE_URL}/generated/index.html`, { waitUntil: 'networkidle', timeout: 15000 });
    if (!response || !response.ok()) throw new Error(`Generated app returned HTTP ${response?.status() || 'unknown'}.`);

    const dom = await page.locator('body').innerHTML();
    const tests = await createBrowserTests(plan, files, dom);
    if (!tests.length) {
      results.push({ name: 'Browser QA plan generated', passed: false, error: 'QA agent did not produce browser tests.' });
    }

    for (const test of tests) {
      try {
        for (const step of test.steps || []) {
          const locator = page.locator(step.selector);
          if (step.action === 'fill') await locator.first().fill(String(step.value ?? 'QA test task'));
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
            if (!text.includes(String(assertion.contains))) throw new Error(`Expected text "${assertion.contains}" in ${assertion.selector}, got "${text}"`);
          } else if (assertion.type === 'notText') {
            const text = await locator.first().innerText().catch(() => '');
            if (text.includes(String(assertion.contains))) throw new Error(`Unexpected text "${assertion.contains}" in ${assertion.selector}`);
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

    if (consoleErrors.length || pageErrors.length) {
      results.push({ name: 'Browser console errors', passed: false, error: [...consoleErrors, ...pageErrors].slice(0, 5).join(' | ') });
    } else {
      results.push({ name: 'Browser console errors', passed: true });
    }
  } catch (error) {
    results.push({ name: 'Browser launch / page load', passed: false, error: `${error.message}. If Chromium is missing, run: npx playwright install chromium` });
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
  return results;
}

async function repairFromFailures(plan, files, failures) {
  const repair = `The generated app failed real browser QA. Fix ONLY the listed failures while preserving the requested scope.
FAILURES:\n${failures.map((failure, i) => `${i + 1}. ${failure.name}: ${failure.error || 'failed'}`).join('\n')}
Regenerate complete project files. Make the interactions actually work, not just visually appear to work.`;
  return generateBuild(plan, repair);
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
    let build = await generateBuild(plan);
    await writeGeneratedProject(build.files);
    let tests = await testGeneratedProject(build.files);
    let browserTests = await runBrowserTests(plan, build.files);
    tests = [...tests, ...browserTests];

    const failures = tests.filter(test => !test.passed);
    if (failures.length) {
      console.log(`QA found ${failures.length} failure(s). Asking builder to repair.`);
      build = await repairFromFailures(plan, build.files, failures);
      await writeGeneratedProject(build.files);
      tests = [...await testGeneratedProject(build.files), ...await runBrowserTests(plan, build.files)];
    }

    res.json({ ...build, tests, mode: 'ai', repaired: failures.length > 0 });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message || 'The builder agent failed. Check the server terminal.' });
  }
});

app.use('/generated', express.static(GENERATED_ROOT));
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.listen(PORT, () => console.log(`MY-AGENT running on http://localhost:${PORT}`));
