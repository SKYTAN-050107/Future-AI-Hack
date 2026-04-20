import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const frontendDir = resolve(scriptDir, '..')
const repoRoot = resolve(frontendDir, '..')

const mode = process.argv[2]
const targets = {
  diagnosis: {
    cwd: resolve(repoRoot, 'backend', 'diagnosis'),
    args: ['-m', 'uvicorn', 'main:app', '--reload', '--host', '0.0.0.0', '--port', '8000'],
  },
  swarm: {
    cwd: resolve(repoRoot, 'backend', 'swarm'),
    args: ['main.py'],
  },
}

const target = targets[mode]

if (!target) {
  console.error('Usage: node ./scripts/run-backend.js <diagnosis|swarm>')
  process.exit(1)
}

function isWorkingPython(command, args = []) {
  const result = spawnSync(command, [...args, '--version'], {
    stdio: 'ignore',
    shell: false,
  })

  return !result.error && result.status === 0
}

function resolvePythonInterpreter() {
  const candidates = []

  const pythonOverride = process.env.PYTHON?.trim()
  if (pythonOverride) {
    candidates.push({ command: pythonOverride, args: [] })
  }

  const venvRoots = [
    resolve(repoRoot, '.venv'),
    resolve(frontendDir, '.venv'),
    resolve(repoRoot, 'backend', '.venv'),
    resolve(repoRoot, 'backend', 'diagnosis', '.venv'),
    resolve(repoRoot, 'backend', 'swarm', '.venv'),
  ]

  for (const venvRoot of venvRoots) {
    const interpreterPath = process.platform === 'win32'
      ? resolve(venvRoot, 'Scripts', 'python.exe')
      : resolve(venvRoot, 'bin', 'python')

    if (existsSync(interpreterPath)) {
      candidates.push({ command: interpreterPath, args: [] })
    }
  }

  if (process.platform === 'win32') {
    candidates.push({ command: 'python', args: [] })
    candidates.push({ command: 'py', args: ['-3'] })
  } else {
    candidates.push({ command: 'python3', args: [] })
    candidates.push({ command: 'python', args: [] })
  }

  for (const candidate of candidates) {
    if (isWorkingPython(candidate.command, candidate.args)) {
      return candidate
    }
  }

  return null
}

const pythonInterpreter = resolvePythonInterpreter()

if (!pythonInterpreter) {
  console.error('No usable Python interpreter found.')
    console.error('Set PYTHON to the interpreter path, or create a .venv in the repo root or backend folder before running npm run dev:backend.')
  process.exit(1)
}

const child = spawn(pythonInterpreter.command, [...pythonInterpreter.args, ...target.args], {
  cwd: target.cwd,
  stdio: 'inherit',
  shell: false,
})

child.on('error', (error) => {
  console.error(error.message)
  process.exit(1)
})

child.on('exit', (code) => {
  process.exit(code ?? 0)
})