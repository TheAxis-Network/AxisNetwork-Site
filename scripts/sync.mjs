#!/usr/bin/env node
/**
 * Writes data/snapshot.json: org info, repos (with languages + contributors),
 * members and every repo's file tree. The site paints from this instantly and
 * falls back to it whenever the GitHub API is rate limited.
 *
 *   GITHUB_TOKEN=... node scripts/sync.mjs
 *
 * A token is optional locally but strongly recommended (60 vs 5000 req/hour).
 * A token with `read:org` also picks up members whose membership is private.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const win = {};
new Function("window", await readFile(resolve(root, "js/config.js"), "utf8"))(win);
const CFG = win.AXIS_CONFIG;

const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
const headers = {
  Accept: "application/vnd.github+json",
  "User-Agent": "axis-network-site-sync",
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
};

async function gh(path) {
  const res = await fetch(`https://api.github.com${path}`, { headers });
  if (res.status === 204) return null;
  if (res.status === 409 || res.status === 404) return { __missing: true };
  if (!res.ok) throw new Error(`GitHub ${res.status} for ${path}: ${await res.text()}`);
  return res.json();
}

async function ghAll(path) {
  const sep = path.includes("?") ? "&" : "?";
  const out = [];
  for (let page = 1; page < 50; page++) {
    const batch = await gh(`${path}${sep}per_page=100&page=${page}`);
    if (!Array.isArray(batch)) break;
    out.push(...batch);
    if (batch.length < 100) break;
  }
  return out;
}

const isBot = (u) => u.type === "Bot" || /\[bot\]$/i.test(u.login);

const org = await gh(`/orgs/${CFG.org}`);
const hiddenRepos = new Set(CFG.hiddenRepos || []);
const rawRepos = (await ghAll(`/orgs/${CFG.org}/repos?type=public&sort=pushed`)).filter(
  (r) => !r.private && !hiddenRepos.has(r.name)
);

// With a read:org token this returns private members too; otherwise public only.
let orgMembers = token ? await ghAll(`/orgs/${CFG.org}/members`).catch(() => []) : [];
if (!orgMembers.length) orgMembers = await ghAll(`/orgs/${CFG.org}/public_members`).catch(() => []);

const repos = [];
const trees = {};
for (const r of rawRepos) {
  const languages = (await gh(`/repos/${r.full_name}/languages`)) || {};
  const contributors = r.size === 0 ? [] : (await ghAll(`/repos/${r.full_name}/contributors`)) || [];
  repos.push({
    name: r.name,
    full_name: r.full_name,
    description: r.description,
    html_url: r.html_url,
    homepage: r.homepage,
    language: r.language,
    languages: languages.__missing ? {} : languages,
    stargazers_count: r.stargazers_count,
    forks_count: r.forks_count,
    watchers_count: r.watchers_count,
    open_issues_count: r.open_issues_count,
    license: r.license ? { spdx_id: r.license.spdx_id, name: r.license.name } : null,
    default_branch: r.default_branch,
    topics: r.topics || [],
    fork: r.fork,
    archived: r.archived,
    size: r.size,
    created_at: r.created_at,
    updated_at: r.updated_at,
    pushed_at: r.pushed_at,
    contributors: contributors
      .filter((c) => !isBot(c))
      .map((c) => ({ login: c.login, avatar_url: c.avatar_url, contributions: c.contributions })),
  });

  const branch = r.size === 0 ? null : await gh(`/repos/${r.full_name}/branches/${encodeURIComponent(r.default_branch)}`);
  if (!branch || branch.__missing) {
    trees[r.name] = { empty: true };
    continue;
  }
  const t = await gh(`/repos/${r.full_name}/git/trees/${branch.commit.sha}?recursive=1`);
  trees[r.name] = t.__missing
    ? { empty: true }
    : {
        sha: branch.commit.sha,
        truncated: !!t.truncated,
        tree: t.tree.map(({ path, type, size, sha }) => ({ path, type, size, sha })),
      };
}

// Members: configured + org members + contributors.
const hidden = new Set((CFG.hiddenMembers || []).map((l) => l.toLowerCase()));
const listed = new Set((CFG.members || []).map((l) => l.toLowerCase()));
const memberSet = new Set(orgMembers.map((m) => m.login.toLowerCase()));
const contrib = new Map();
for (const repo of repos) {
  for (const c of repo.contributors) {
    const k = c.login.toLowerCase();
    const e = contrib.get(k) || { contributions: 0, repos: [] };
    e.contributions += c.contributions;
    e.repos.push(repo.name);
    contrib.set(k, e);
  }
}
const logins = new Map();
for (const l of [
  ...(CFG.members || []),
  ...orgMembers.filter((m) => !isBot(m)).map((m) => m.login),
  ...repos.flatMap((r) => r.contributors.map((c) => c.login)),
]) {
  if (!logins.has(l.toLowerCase())) logins.set(l.toLowerCase(), l);
}

const members = [];
for (const [k, login] of logins) {
  if (hidden.has(k)) continue;
  const u = await gh(`/users/${encodeURIComponent(login)}`);
  if (!u || u.__missing) continue;
  const c = contrib.get(k) || { contributions: 0, repos: [] };
  members.push({
    login: u.login,
    name: u.name,
    avatar_url: u.avatar_url,
    html_url: u.html_url,
    bio: u.bio,
    blog: u.blog,
    location: u.location,
    company: u.company,
    twitter_username: u.twitter_username,
    followers: u.followers,
    public_repos: u.public_repos,
    contributions: c.contributions,
    repos: c.repos,
    role: (CFG.roles || {})[u.login] || (memberSet.has(k) || listed.has(k) ? "Member" : "Contributor"),
  });
}
members.sort((a, b) => b.contributions - a.contributions || a.login.localeCompare(b.login));

const snapshot = {
  syncedAt: Date.now(),
  org: {
    login: org.login,
    name: org.name,
    description: org.description,
    avatar_url: org.avatar_url,
    html_url: org.html_url,
    blog: org.blog,
    email: org.email,
    public_repos: org.public_repos,
    created_at: org.created_at,
  },
  repos,
  members,
  trees,
};

const out = resolve(root, "data/snapshot.json");
await mkdir(dirname(out), { recursive: true });

// Only rewrite when content changed, so the workflow doesn't commit noise.
let previous = null;
try {
  previous = JSON.parse(await readFile(out, "utf8"));
} catch {}
const strip = (s) => JSON.stringify({ ...s, syncedAt: 0 });
if (previous && strip(previous) === strip(snapshot)) {
  console.log("snapshot unchanged");
} else {
  await writeFile(out, JSON.stringify(snapshot, null, 1) + "\n");
  console.log(`snapshot written: ${repos.length} repos, ${members.length} members`);
}
