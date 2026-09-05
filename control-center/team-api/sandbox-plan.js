'use strict';

const SAFE_FRAMEWORKS = new Set(['vite', 'react', 'angular', 'astro']);

function packageManagerFromFiles(paths) {
  const set = new Set((paths || []).map((value) => String(value).toLowerCase()));
  if (set.has('pnpm-lock.yaml')) return 'pnpm';
  if (set.has('yarn.lock')) return 'yarn';
  if (set.has('package-lock.json') || set.has('npm-shrinkwrap.json')) return 'npm';
  return 'npm';
}

function installCommand(manager, hasLockfile) {
  if (manager === 'pnpm') {
    return hasLockfile
      ? ['corepack', 'pnpm', 'install', '--frozen-lockfile', '--ignore-scripts']
      : ['corepack', 'pnpm', 'install', '--ignore-scripts'];
  }
  if (manager === 'yarn') {
    return hasLockfile
      ? ['corepack', 'yarn', 'install', '--frozen-lockfile', '--ignore-scripts']
      : ['corepack', 'yarn', 'install', '--ignore-scripts'];
  }
  return hasLockfile
    ? ['npm', 'ci', '--ignore-scripts', '--no-audit', '--no-fund']
    : ['npm', 'install', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false'];
}

function buildCommand(framework) {
  switch (framework) {
    case 'vite': return ['./node_modules/.bin/vite', 'build'];
    case 'react': return ['./node_modules/.bin/react-scripts', 'build'];
    case 'angular': return ['./node_modules/.bin/ng', 'build'];
    case 'astro': return ['./node_modules/.bin/astro', 'build'];
    default: return null;
  }
}

function outputDirectory(detected) {
  if (detected && typeof detected.outputDir === 'string' && detected.outputDir.trim()) {
    return detected.outputDir.trim();
  }
  return null;
}

function createSandboxPlan(detected, repositoryFiles) {
  if (!detected || detected.mode !== 'build-required') {
    const error = new Error('Build sandbox is not required for this preview.');
    error.code = 'sandbox_not_required';
    throw error;
  }
  const framework = String(detected.framework || 'unknown');
  if (detected.runtime && detected.runtime !== 'static') {
    return {
      supported: false,
      reason: 'runtime_preview_not_supported',
      framework,
      branch: detected.branch || null
    };
  }
  if (!SAFE_FRAMEWORKS.has(framework)) {
    return {
      supported: false,
      reason: 'framework_not_supported',
      framework,
      branch: detected.branch || null
    };
  }

  const files = Array.isArray(repositoryFiles) ? repositoryFiles : [];
  const manager = packageManagerFromFiles(files);
  const lowerFiles = new Set(files.map((value) => String(value).toLowerCase()));
  const hasLockfile = lowerFiles.has('package-lock.json')
    || lowerFiles.has('npm-shrinkwrap.json')
    || lowerFiles.has('pnpm-lock.yaml')
    || lowerFiles.has('yarn.lock');
  const build = buildCommand(framework);
  const outputDir = outputDirectory(detected);
  if (!build || !outputDir) {
    return {
      supported: false,
      reason: 'build_command_unavailable',
      framework,
      branch: detected.branch || null
    };
  }

  return {
    supported: true,
    framework,
    branch: detected.branch || null,
    packageManager: manager,
    install: installCommand(manager, hasLockfile),
    build,
    outputDir,
    isolation: {
      productionSecrets: false,
      runAsRoot: false,
      writableWorkspaceOnly: true,
      buildNetwork: false,
      installNetwork: 'outbound-required',
      cpuLimit: 1,
      memoryMb: 768,
      timeoutSeconds: 180,
      pidsLimit: 256
    }
  };
}

module.exports = {
  SAFE_FRAMEWORKS,
  packageManagerFromFiles,
  createSandboxPlan
};
