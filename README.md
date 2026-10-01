# MY-AGENT 🚀

MY-AGENT is an AI Project Builder that turns a natural-language app idea into a structured plan and generated project.

The goal is to make the agent behave more like an autonomous software engineer: understand the idea, plan the work, generate the project, test it in a real browser, review the result, and repair failures.

## Current Flow

```text
Idea
  ↓
Plan
  ↓
Generate
  ↓
Static QA
  ↓
Browser QA
  ↓
Visual QA
  ↓
Repair failures
  ↓
Generated App
```

## What it can do

- Accept an application idea in natural language
- Convert the idea into structured requirements and development tasks
- Generate project files with an AI coding agent
- Write the generated project to a local workspace
- Run browser-based checks against the generated app
- Check JavaScript syntax and asset references
- Capture screenshots for visual review
- Use AI visual review to identify obvious UI problems
- Retry generation when automated QA finds failures
- Open the generated application directly in the browser

## Example

Input:

> Build a simple todo app where users can add, complete, and delete tasks.

MY-AGENT can turn that idea into a generated project containing the required HTML, CSS, and JavaScript, then run automated checks against it.

## Why I'm Building This

Most AI coding tools can generate code. MY-AGENT is being built around a different idea:

**Don't just generate code. Build it, run it, test it, inspect it, and improve it.**

The long-term goal is to make the agent capable of taking a project from an idea to a usable implementation with as little manual intervention as possible.

## Roadmap

- [x] Natural-language project planning
- [x] AI project generation
- [x] Static project checks
- [x] Real browser testing
- [x] Screenshot-based visual QA pipeline
- [x] Automatic repair after QA failures
- [ ] Stronger visual QA reliability
- [ ] Multi-file debugging agent
- [ ] Better project persistence
- [ ] Git/GitHub project workflow automation
- [ ] Production deployment workflow

## Development

Clone the repository and install dependencies:

```bash
npm install
```

Create a `.env` file from `.env.example` and add your OpenRouter API key.

Then start the agent:

```bash
npm start
```

The local application runs on:

```text
http://localhost:3000
```

## Status

🚧 **Active development** — the core build → test → review loop is being developed and improved continuously.

## License

This project is currently being developed as a personal project.
