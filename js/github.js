/* GitHub data layer: conditional (ETag) requests, local caching, live sync. */
(function () {
  const CFG = window.AXIS_CONFIG;
  const API = "https://api.github.com";

  const LS = {
    get(key) {
      try {
        const v = localStorage.getItem(key);
        return v ? JSON.parse(v) : null;
      } catch {
        return null;
      }
    },
    set(key, value) {
      const raw = JSON.stringify(value);
      try {
        localStorage.setItem(key, raw);
      } catch {
        // Quota exceeded: drop the request cache and retry once.
        try {
          Object.keys(localStorage)
            .filter((k) => k.startsWith("axis:etag:"))
            .forEach((k) => localStorage.removeItem(k));
          localStorage.setItem(key, raw);
        } catch {}
      }
    },
  };

  class RateLimitError extends Error {
    constructor(reset) {
      super("GitHub API rate limit reached");
      this.rateLimited = true;
      this.reset = reset;
    }
  }

  const rate = { limit: null, remaining: null, reset: null, limited: false };

  function readRate(res) {
    const remaining = res.headers.get("x-ratelimit-remaining");
    if (remaining == null) return;
    rate.remaining = +remaining;
    rate.limit = +res.headers.get("x-ratelimit-limit");
    rate.reset = +res.headers.get("x-ratelimit-reset") * 1000;
  }

  /**
   * GET an API path. Responses are cached with their ETag; a 304 reply returns
   * the cached body and does not count against the rate limit.
   * `immutable` skips the network entirely once cached (e.g. trees by SHA).
   */
  async function gh(path, { immutable = false } = {}) {
    const url = API + path;
    const key = "axis:etag:" + url;
    const cached = LS.get(key);
    if (immutable && cached) return cached.data;

    if (rate.remaining === 0 && rate.reset > Date.now()) {
      rate.limited = true;
      if (cached) return cached.data;
      throw new RateLimitError(rate.reset);
    }

    const headers = { Accept: "application/vnd.github+json" };
    if (cached && cached.etag) headers["If-None-Match"] = cached.etag;

    let res;
    try {
      res = await fetch(url, { headers });
    } catch (err) {
      if (cached) return cached.data;
      throw err;
    }
    readRate(res);

    if (res.status === 304 && cached) return cached.data;
    if (res.status === 204) return null;
    if (res.status === 409) return { __empty: true }; // empty repository
    if (res.status === 403 || res.status === 429) {
      if (rate.remaining === 0 || res.headers.get("retry-after")) {
        rate.limited = true;
        if (!rate.reset || rate.reset < Date.now()) rate.reset = Date.now() + 60_000;
        if (cached) return cached.data;
        throw new RateLimitError(rate.reset);
      }
    }
    if (!res.ok) {
      const err = new Error(`GitHub responded ${res.status} for ${path}`);
      err.status = res.status;
      throw err;
    }
    const data = await res.json();
    LS.set(key, { etag: res.headers.get("etag"), data });
    return data;
  }

  async function ghAll(path) {
    const sep = path.includes("?") ? "&" : "?";
    const out = [];
    for (let page = 1; page < 20; page++) {
      const batch = (await gh(`${path}${sep}per_page=100&page=${page}`)) || [];
      out.push(...batch);
      if (batch.length < 100) break;
    }
    return out;
  }

  const isBot = (u) => u.type === "Bot" || /\[bot\]$/i.test(u.login);

  function slimOrg(o) {
    return {
      login: o.login,
      name: o.name,
      description: o.description,
      avatar_url: o.avatar_url,
      html_url: o.html_url,
      blog: o.blog,
      email: o.email,
      public_repos: o.public_repos,
      created_at: o.created_at,
    };
  }

  function slimRepo(r, languages, contributors) {
    return {
      name: r.name,
      full_name: r.full_name,
      description: r.description,
      html_url: r.html_url,
      homepage: r.homepage,
      language: r.language,
      languages: languages || {},
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
      contributors: (contributors || [])
        .filter((c) => !isBot(c))
        .map((c) => ({ login: c.login, avatar_url: c.avatar_url, contributions: c.contributions })),
    };
  }

  function buildMembers(repos, publicMembers, users) {
    const hidden = new Set((CFG.hiddenMembers || []).map((l) => l.toLowerCase()));
    const listed = new Set((CFG.members || []).map((l) => l.toLowerCase()));
    const pub = new Set(publicMembers.map((m) => m.login.toLowerCase()));
    const contrib = new Map();
    for (const repo of repos) {
      for (const c of repo.contributors) {
        const k = c.login.toLowerCase();
        const entry = contrib.get(k) || { contributions: 0, repos: [] };
        entry.contributions += c.contributions;
        entry.repos.push(repo.name);
        contrib.set(k, entry);
      }
    }
    return users
      .filter((u) => u && !hidden.has(u.login.toLowerCase()))
      .map((u) => {
        const k = u.login.toLowerCase();
        const c = contrib.get(k) || { contributions: 0, repos: [] };
        const isMember = pub.has(k) || listed.has(k);
        return {
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
          role: (CFG.roles || {})[u.login] || (isMember ? "Member" : "Contributor"),
        };
      })
      .sort((a, b) => b.contributions - a.contributions || a.login.localeCompare(b.login));
  }

  /** Discover the login list: configured + public org members + repo contributors. */
  function memberLogins(repos, publicMembers) {
    const seen = new Map();
    const add = (login) => {
      if (login && !seen.has(login.toLowerCase())) seen.set(login.toLowerCase(), login);
    };
    (CFG.members || []).forEach(add);
    publicMembers.filter((m) => !isBot(m)).forEach((m) => add(m.login));
    repos.forEach((r) => r.contributors.forEach((c) => add(c.login)));
    return [...seen.values()];
  }

  /** Full live sync against the API. Missing pieces fall back to `prev`. */
  async function syncLive(prev) {
    rate.limited = false;
    const prevRepo = new Map((prev?.repos || []).map((r) => [r.name, r]));
    const prevUser = new Map((prev?.members || []).map((m) => [m.login.toLowerCase(), m]));
    const keep = (promise, fallback) =>
      promise.catch((err) => {
        if (err.rateLimited) rate.limited = true;
        return fallback;
      });

    const org = await gh(`/orgs/${CFG.org}`);
    const hiddenRepos = new Set(CFG.hiddenRepos || []);
    const rawRepos = (await ghAll(`/orgs/${CFG.org}/repos?type=public&sort=pushed`)).filter(
      (r) => !r.private && !hiddenRepos.has(r.name)
    );
    const publicMembers = await keep(ghAll(`/orgs/${CFG.org}/public_members`), []);

    const repos = await Promise.all(
      rawRepos.map(async (r) => {
        const old = prevRepo.get(r.name);
        const [languages, contributors] = await Promise.all([
          keep(gh(`/repos/${r.full_name}/languages`), old?.languages || {}),
          r.size === 0
            ? []
            : keep(gh(`/repos/${r.full_name}/contributors?per_page=100`), old?.contributors || []),
        ]);
        return slimRepo(r, languages, Array.isArray(contributors) ? contributors : []);
      })
    );

    const logins = memberLogins(repos, publicMembers);
    const users = await Promise.all(
      logins.map((login) => keep(gh(`/users/${encodeURIComponent(login)}`), prevUser.get(login.toLowerCase()) || null))
    );

    return {
      org: slimOrg(org),
      repos,
      members: buildMembers(repos, publicMembers, users),
      syncedAt: Date.now(),
      source: rate.limited ? "partial" : "live",
    };
  }

  /** Compare two states and describe what changed. */
  function diff(prev, next) {
    const changes = { addedRepos: [], updatedRepos: [], removedRepos: [], addedMembers: [], removedMembers: [] };
    if (!prev) return changes;
    const pr = new Map(prev.repos.map((r) => [r.name, r]));
    const nr = new Map(next.repos.map((r) => [r.name, r]));
    for (const r of next.repos) {
      if (!pr.has(r.name)) changes.addedRepos.push(r);
      else if (pr.get(r.name).pushed_at !== r.pushed_at) changes.updatedRepos.push(r);
    }
    for (const r of prev.repos) if (!nr.has(r.name)) changes.removedRepos.push(r);
    const pm = new Set(prev.members.map((m) => m.login));
    const nm = new Set(next.members.map((m) => m.login));
    changes.addedMembers = next.members.filter((m) => !pm.has(m.login));
    changes.removedMembers = prev.members.filter((m) => !nm.has(m.login));
    return changes;
  }

  /** Resolve the default branch head and its full recursive file tree. */
  async function getRepoTree(repo) {
    if (repo.size === 0) return { empty: true };
    let branch;
    try {
      branch = await gh(`/repos/${repo.full_name}/branches/${encodeURIComponent(repo.default_branch)}`);
    } catch (err) {
      if (err.status === 404) return { empty: true };
      throw err;
    }
    if (!branch || branch.__empty) return { empty: true };
    const sha = branch.commit.sha;
    const t = await gh(`/repos/${repo.full_name}/git/trees/${sha}?recursive=1`, { immutable: true });
    if (!t || t.__empty) return { empty: true };
    return {
      sha,
      truncated: !!t.truncated,
      tree: t.tree.map(({ path, type, size, sha }) => ({ path, type, size, sha })),
    };
  }

  const encodePath = (p) => p.split("/").map(encodeURIComponent).join("/");
  const rawUrl = (repo, ref, path) =>
    `https://raw.githubusercontent.com/${repo.full_name}/${ref}/${encodePath(path)}`;
  const zipUrl = (repo) =>
    `https://github.com/${repo.full_name}/archive/refs/heads/${encodeURIComponent(repo.default_branch)}.zip`;

  async function loadSnapshot() {
    try {
      const res = await fetch(CFG.snapshotUrl, { cache: "no-cache" });
      if (!res.ok) return null;
      const snap = await res.json();
      snap.source = "snapshot";
      return snap;
    } catch {
      return null;
    }
  }

  window.AxisGH = { gh, syncLive, diff, getRepoTree, rawUrl, zipUrl, encodePath, loadSnapshot, rate, LS };
})();
