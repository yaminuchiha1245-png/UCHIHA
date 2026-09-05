'use strict';

const { getRepoFile } = require('./github-client');

function activeBranch(binding) {
  if (!binding || !binding.repository || !binding.branch) {
    const error = new Error('Project is not linked to GitHub.');
    error.code = 'preview_github_not_linked';
    throw error;
  }
  return binding.previewBranch || binding.activeBranch || binding.branch;
}

function dependencySet(pkg) {
  return new Set([
    ...Object.keys(pkg && pkg.dependencies || {}),
    ...Object.keys(pkg && pkg.devDependencies || {})
  ]);
}

function detectPackage(pkg) {
  const deps = dependencySet(pkg);
  const scripts = pkg && pkg.scripts && typeof pkg.scripts === 'object' ? pkg.scripts : {};
  const hasBuildScript = typeof scripts.build === 'string' && scripts.build.trim().length > 0;

  if (deps.has('vite')) return { framework: 'vite', outputDir: 'dist', runtime: 'static', hasBuildScript };
  if (deps.has('react-scripts')) return { framework: 'react', outputDir: 'build', runtime: 'static', hasBuildScript };
  if (deps.has('next')) return { framework: 'next', outputDir: null, runtime: 'node', hasBuildScript };
  if (deps.has('@angular/cli')) return { framework: 'angular', outputDir: 'dist', runtime: 'static', hasBuildScript };
  if (deps.has('@sveltejs/kit')) return { framework: 'sveltekit', outputDir: null, runtime: 'node', hasBuildScript };
  if (deps.has('astro')) return { framework: 'astro', outputDir: 'dist', runtime: 'static', hasBuildScript };
  if (hasBuildScript) return { framework: 'node-build', outputDir: null, runtime: 'unknown', hasBuildScript: true };
  return { framework: 'node', outputDir: null, runtime: 'node', hasBuildScript: false };
}

async function detectPreviewProject(token, binding) {
  const branch = activeBranch(binding);
  try {
    await getRepoFile(token, binding.repository, branch, 'index.html');
    return {
      mode: 'static-source',
      framework: 'static',
      entry: 'index.html',
      branch,
      runtime: 'static',
      buildRequired: false
    };
  } catch (error) {
    if (!error || error.code !== 'github_source_not_found') throw error;
  }

  try {
    const manifest = await getRepoFile(token, binding.repository, branch, 'package.json');
    let pkg;
    try {
      pkg = JSON.parse(manifest.data.toString('utf8'));
    } catch {
      const error = new Error('package.json is invalid.');
      error.code = 'preview_manifest_invalid';
      throw error;
    }
    const detected = detectPackage(pkg);
    return {
      mode: 'build-required',
      entry: null,
      branch,
      buildRequired: true,
      ...detected
    };
  } catch (error) {
    if (!error || error.code !== 'github_source_not_found') throw error;
  }

  return {
    mode: 'build-required',
    framework: 'unknown',
    entry: null,
    branch,
    runtime: 'unknown',
    outputDir: null,
    hasBuildScript: false,
    buildRequired: true
  };
}

module.exports = {
  activeBranch,
  detectPackage,
  detectPreviewProject
};
