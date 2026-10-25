/* TheAxis-Network site: rendering, routing, live sync and downloads. */
(function () {
  const CFG = window.AXIS_CONFIG;
  const GH = window.AxisGH;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  /* ═════════ Helpers ═════════ */
  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const icon = (id, cls = "") => `<svg class="ic ${cls}"><use href="#i-${id}"/></svg>`;
  const nf = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
  const fmtNum = (n) => nf.format(n || 0);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  function relTime(input) {
    const diff = (new Date(input).getTime() - Date.now()) / 1000;
    const units = [["year", 31536000], ["month", 2592000], ["week", 604800], ["day", 86400], ["hour", 3600], ["minute", 60]];
    for (const [unit, sec] of units) if (Math.abs(diff) >= sec) return rtf.format(Math.round(diff / sec), unit);
    return "just now";
  }
  function fmtBytes(b) {
    if (b == null) return "";
    const u = ["B", "KB", "MB", "GB"];
    let i = 0;
    while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
    return `${b < 10 && i ? b.toFixed(1) : Math.round(b)} ${u[i]}`;
  }
  const fmtTime = (ms) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const normUrl = (u) => (!u ? "" : /^https?:\/\//i.test(u) ? u : `https://${u}`);
  const routeTo = (...segs) => "#/" + segs.filter((s) => s !== "" && s != null).map((s) => String(s).split("/").map(encodeURIComponent).join("/")).join("/");

  /* Language colours (GitHub linguist, with very dark ones lifted for contrast). */
  const LANG_COLORS = {
    JavaScript: "#f1e05a", TypeScript: "#3178c6", Lua: "#6f7cff", HTML: "#e34c26", CSS: "#8e5bd6", SCSS: "#c6538c",
    Python: "#3572a5", Shell: "#89e051", Go: "#00add8", Rust: "#dea584", C: "#8a8f98", "C++": "#f34b7d", "C#": "#178600",
    Java: "#b07219", Kotlin: "#a97bff", Swift: "#f05138", Ruby: "#cc342d", PHP: "#4f5d95", Dockerfile: "#3b8bba",
    Vue: "#41b883", Svelte: "#ff3e00", Makefile: "#427819", Batchfile: "#c1f12e", PowerShell: "#3a7bd5", Nix: "#7e7eff",
    Dart: "#00b4ab", Zig: "#ec915c", Astro: "#ff5a03", MDX: "#fcb32c", Markdown: "#4a7fd1", JSON: "#9aa0a6", Elixir: "#6e4a7e",
    Haskell: "#5e5086", Perl: "#0298c3", R: "#198ce7", Scala: "#c22d40", "Objective-C": "#438eff", Assembly: "#6e4c13",
    WebAssembly: "#7064f0", Solidity: "#aa6746", GLSL: "#5686a5", Handlebars: "#f7931e", EJS: "#a91e50", Pug: "#a86454",
  };
  function langColor(name) {
    if (LANG_COLORS[name]) return LANG_COLORS[name];
    let h = 0;
    for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
    return `hsl(${h} 70% 60%)`;
  }

  function langEntries(languages) {
    const total = Object.values(languages || {}).reduce((a, b) => a + b, 0);
    if (!total) return { total: 0, list: [] };
    const list = Object.entries(languages)
      .sort((a, b) => b[1] - a[1])
      .map(([name, bytes]) => ({ name, bytes, pct: (bytes / total) * 100, color: langColor(name) }));
    return { total, list };
  }
  const fmtPct = (p) => (p < 0.1 ? "<0.1%" : `${p.toFixed(1)}%`);

  /** Percentage bar + legend. `max` collapses the tail into "Other". */
  function langBar(languages, { max = 4, lg = false } = {}) {
    const { list } = langEntries(languages);
    if (!list.length) return `<div class="lang-none">${icon("code")} No language data yet</div>`;
    let shown = list;
    if (list.length > max + 1) {
      const rest = list.slice(max);
      shown = [...list.slice(0, max), { name: "Other", pct: rest.reduce((a, l) => a + l.pct, 0), color: "#8d8d9b", other: rest.map((l) => l.name).join(", ") }];
    }
    const bar = shown
      .map((l) => `<span data-w="${l.pct.toFixed(3)}" style="background:${l.color}" title="${esc(l.name)} ${fmtPct(l.pct)}"></span>`)
      .join("");
    const legend = shown
      .map((l) => `<li${l.other ? ` title="${esc(l.other)}"` : ""}><span class="dot" style="background:${l.color}"></span><span class="name">${esc(l.name)}</span><span class="pct">${fmtPct(l.pct)}</span></li>`)
      .join("");
    return `<div class="langbar${lg ? " lg" : ""}" role="img" aria-label="${esc(shown.map((l) => `${l.name} ${fmtPct(l.pct)}`).join(", "))}">${bar}</div><ul class="lang-legend">${legend}</ul>`;
  }

  /** Animate bars/meters from 0 to their target width once in the DOM. */
  function growBars(root) {
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        $$("[data-w]", root).forEach((el) => (el.style.width = `${el.dataset.w}%`));
      })
    );
  }

  function animateCount(el, to) {
    const from = Number(el.dataset.v || 0);
    el.dataset.v = to;
    if (from === to) { el.textContent = fmtNum(to); return; }
    const start = performance.now();
    const dur = 900;
    const step = (t) => {
      const k = Math.min(1, (t - start) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      el.textContent = fmtNum(Math.round(from + (to - from) * e));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  /* ═════════ Toasts & clipboard ═════════ */
  function toast(html, { iconId = "sparkle", timeout = 5000 } = {}) {
    const el = document.createElement("div");
    el.className = "toast glass";
    el.innerHTML = `${icon(iconId)}<div class="toast-body">${html}</div>`;
    $("#toasts").appendChild(el);
    const close = () => {
      el.classList.add("out");
      setTimeout(() => el.remove(), 300);
    };
    if (timeout) setTimeout(close, timeout);
    return { el, close, body: $(".toast-body", el) };
  }

  async function copyText(text, btn) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = Object.assign(document.createElement("textarea"), { value: text });
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    if (btn) {
      const use = $("use", btn);
      if (use) {
        const prev = use.getAttribute("href");
        use.setAttribute("href", "#i-check");
        setTimeout(() => use.setAttribute("href", prev), 1400);
      }
    }
    toast("Copied to clipboard", { iconId: "check", timeout: 1800 });
  }

  /* ═════════ SVG illustrations ═════════ */
  const ART = {
    empty: `<svg class="art" viewBox="0 0 150 120" fill="none"><rect x="22" y="34" width="106" height="72" rx="12" fill="url(#grad-brand)" opacity=".18"/><path d="M22 46a12 12 0 0 1 12-12h22l9 10h51a12 12 0 0 1 12 12v38a12 12 0 0 1-12 12H34a12 12 0 0 1-12-12V46Z" stroke="currentColor" stroke-width="2" stroke-dasharray="5 6" opacity=".6"/><path d="M112 14c.8 6 3.2 8.4 9.2 9.2-6 .8-8.4 3.2-9.2 9.2-.8-6-3.2-8.4-9.2-9.2 6-.8 8.4-3.2 9.2-9.2Z" fill="#38d6f5"/><circle cx="34" cy="20" r="4" fill="#ff5fae"/><path d="M60 74h30" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" opacity=".5"/></svg>`,
    search: `<svg class="art" viewBox="0 0 150 120" fill="none"><circle cx="66" cy="56" r="34" fill="url(#grad-brand)" opacity=".18"/><circle cx="66" cy="56" r="30" stroke="currentColor" stroke-width="3" opacity=".7"/><path d="m88 78 24 24" stroke="currentColor" stroke-width="6" stroke-linecap="round" opacity=".7"/><path d="M54 50h24M54 62h14" stroke="currentColor" stroke-width="3" stroke-linecap="round" opacity=".4"/><circle cx="118" cy="26" r="4" fill="#38d6f5"/><circle cx="26" cy="96" r="3" fill="#ff5fae"/></svg>`,
    binary: `<svg class="art" viewBox="0 0 120 120" fill="none"><path d="M30 14h40l22 22v62a8 8 0 0 1-8 8H30a8 8 0 0 1-8-8V22a8 8 0 0 1 8-8Z" fill="url(#grad-brand)" opacity=".2"/><path d="M30 14h40l22 22v62a8 8 0 0 1-8 8H30a8 8 0 0 1-8-8V22a8 8 0 0 1 8-8Z" stroke="currentColor" stroke-width="2.5" opacity=".7"/><path d="M70 14v22h22" stroke="currentColor" stroke-width="2.5" opacity=".7"/><text x="34" y="66" font-family="monospace" font-size="12" fill="currentColor" opacity=".55">0101</text><text x="34" y="82" font-family="monospace" font-size="12" fill="currentColor" opacity=".35">1100</text></svg>`,
    lost: `<svg class="art" viewBox="0 0 150 120" fill="none"><circle cx="75" cy="60" r="44" fill="url(#grad-brand)" opacity=".18"/><circle cx="75" cy="60" r="40" stroke="currentColor" stroke-width="2" stroke-dasharray="4 7" opacity=".55"/><path d="M62 50a13 13 0 1 1 18 12c-4 2-5 4-5 8" stroke="currentColor" stroke-width="4" stroke-linecap="round" opacity=".75"/><circle cx="75" cy="82" r="3" fill="currentColor" opacity=".75"/></svg>`,
  };
  const emptyState = (art, title, text, extra = "") =>
    `<div class="empty-state">${ART[art]}<h3>${title}</h3><p>${text}</p>${extra}</div>`;

  /* ═════════ State ═════════ */
  let state = null; // { org, repos, members, syncedAt, source }
  let snapshot = null; // includes trees, used as fallback
  let syncing = false;
  let lastAttempt = 0;
  let liveThisSession = false;
  const ui = { sort: "pushed", query: "", newRepos: new Set(), newMembers: new Set(), renderedOnce: false };

  /* ═════════ Sync status pill ═════════ */
  function updatePill(force) {
    const pill = $("#sync-pill");
    const text = $(".sync-text", pill);
    const st = force || pill.dataset.state || "idle";
    pill.dataset.state = st;
    let label = "Connecting…";
    let title = "Sync with GitHub now";
    if (st === "syncing") label = "Syncing…";
    else if (st === "live") label = `Live · ${relTime(state.syncedAt)}`;
    else if (st === "limited") {
      label = GH.rate.reset ? `Rate limited · ${fmtTime(GH.rate.reset)}` : "Rate limited";
      title = "GitHub's hourly API limit was reached. Showing the latest saved data; live updates resume automatically.";
    } else if (st === "snapshot") label = "Snapshot";
    else if (st === "error") { label = "Offline"; title = "Couldn't reach GitHub. Click to retry."; }
    text.textContent = label;
    pill.title = title;
    if (state) {
      $("#footer-sync").textContent = `Synced with GitHub ${relTime(state.syncedAt)} · refreshes every ${Math.round(CFG.refreshInterval / 60000)} min`;
    }
  }

  async function sync({ manual = false } = {}) {
    if (syncing) return;
    syncing = true;
    lastAttempt = Date.now();
    updatePill("syncing");
    try {
      const prev = state;
      const next = await GH.syncLive(prev);
      const changes = GH.diff(prev, next);
      if (liveThisSession) announce(changes);
      changes.addedRepos.forEach((r) => liveThisSession && ui.newRepos.add(r.name));
      changes.addedMembers.forEach((m) => liveThisSession && ui.newMembers.add(m.login));
      liveThisSession = true;
      state = next;
      GH.LS.set("axis:state", next);
      renderAll();
      await onRepoChanges(changes);
      updatePill(GH.rate.limited ? "limited" : "live");
      if (manual && !GH.rate.limited) toast("Up to date with GitHub", { iconId: "check", timeout: 2200 });
    } catch (err) {
      console.warn("[axis] sync failed:", err);
      updatePill(err.rateLimited ? "limited" : state ? (state.source === "snapshot" ? "snapshot" : "error") : "error");
      if (!state) renderLoadError(err);
      if (route.view === "repo" && !currentRepo()) showRepo(false);
      if (manual) toast(err.rateLimited ? `GitHub rate limit reached. Live updates resume at <b>${fmtTime(GH.rate.reset)}</b>.` : "Couldn't reach GitHub right now.", { iconId: "clock" });
    } finally {
      syncing = false;
    }
  }

  function announce(c) {
    c.addedRepos.forEach((r) => toast(`New repository <b>${esc(r.name)}</b>`, { iconId: "repo" }));
    c.updatedRepos.forEach((r) => toast(`<b>${esc(r.name)}</b> was just updated`, { iconId: "refresh" }));
    c.removedRepos.forEach((r) => toast(`<b>${esc(r.name)}</b> is no longer public`, { iconId: "x" }));
    c.addedMembers.forEach((m) => toast(`Welcome <b>@${esc(m.login)}</b> to the network`, { iconId: "users" }));
  }

  function scheduleLoop() {
    setInterval(() => {
      updatePill();
      if (document.hidden) return;
      if (GH.rate.limited && GH.rate.reset > Date.now()) return;
      if (Date.now() - lastAttempt >= CFG.refreshInterval) sync();
    }, 15000);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && Date.now() - lastAttempt > 60000 && !(GH.rate.limited && GH.rate.reset > Date.now())) sync();
    });
  }

  /* ═════════ Home rendering ═════════ */
  function renderAll() {
    if (!state) return;
    renderStats();
    renderLangOverview();
    renderRepos();
    renderMembers();
    if (route.view === "repo") renderRepoChrome();
    ui.renderedOnce = true;
  }

  function renderStats() {
    const langs = new Set(state.repos.flatMap((r) => Object.keys(r.languages || {})));
    const stars = state.repos.reduce((a, r) => a + (r.stargazers_count || 0), 0);
    const vals = { repos: state.repos.length, members: state.members.length, languages: langs.size, stars };
    $$("[data-stat]").forEach((el) => animateCount(el, vals[el.dataset.stat]));
  }

  function renderLangOverview() {
    const totals = {};
    for (const r of state.repos) for (const [l, b] of Object.entries(r.languages || {})) totals[l] = (totals[l] || 0) + b;
    const box = $("#lang-overview");
    const { total } = langEntries(totals);
    box.hidden = !total;
    if (!total) return;
    $("#lang-overview-total").textContent = `${fmtBytes(total)} of code across ${state.repos.length} repositories`;
    const body = $("#lang-overview-body");
    body.innerHTML = langBar(totals, { max: 8, lg: true });
    growBars(body);
  }

  function sortedRepos() {
    const q = ui.query.trim().toLowerCase();
    let list = state.repos.filter(
      (r) =>
        !q ||
        r.name.toLowerCase().includes(q) ||
        (r.description || "").toLowerCase().includes(q) ||
        Object.keys(r.languages || {}).some((l) => l.toLowerCase().includes(q)) ||
        (r.topics || []).some((t) => t.includes(q))
    );
    const by = {
      pushed: (a, b) => new Date(b.pushed_at) - new Date(a.pushed_at),
      stars: (a, b) => b.stargazers_count - a.stargazers_count || new Date(b.pushed_at) - new Date(a.pushed_at),
      name: (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
    };
    return list.sort(by[ui.sort]);
  }

  function repoIconStyle(repo) {
    const { list } = langEntries(repo.languages);
    const c1 = list[0]?.color || "#8b7bff";
    const c2 = list[1]?.color || "#38d6f5";
    return `--c1:${c1};--c2:${c2}`;
  }

  const isRecent = (repo) => Date.now() - new Date(repo.pushed_at).getTime() < 7 * 86400000;

  function repoCard(repo, i) {
    const anim = !ui.renderedOnce ? ` style="animation: pop-in .7s ${i * 70}ms both"` : "";
    return `
    <article class="repo-card glass${ui.newRepos.has(repo.name) ? " is-new" : ""}"${anim}>
      <div class="repo-card-head">
        <div class="repo-icon" style="${repoIconStyle(repo)}">${icon("repo")}</div>
        <div class="repo-title">
          <h3><a href="${routeTo("repo", repo.name)}">${esc(repo.name)}</a></h3>
          <div class="repo-sub">${icon("branch")} ${esc(repo.default_branch)} ${repo.archived ? '<span class="badge">Archived</span>' : ""}${repo.fork ? '<span class="badge">Fork</span>' : ""}</div>
        </div>
        ${isRecent(repo) ? `<span class="badge updated">${icon("pulse")} Active</span>` : ""}
      </div>
      <p class="repo-desc${repo.description ? "" : " empty"}">${esc(repo.description || "No description provided.")}</p>
      <div class="repo-langs">${langBar(repo.languages, { max: 3 })}</div>
      <div class="repo-meta">
        <span title="Stars">${icon("star")} ${fmtNum(repo.stargazers_count)}</span>
        <span title="Forks">${icon("fork")} ${fmtNum(repo.forks_count)}</span>
        ${repo.license && repo.license.spdx_id !== "NOASSERTION" ? `<span title="${esc(repo.license.name)}">${icon("scale")} ${esc(repo.license.spdx_id)}</span>` : ""}
        <span title="Last push ${esc(new Date(repo.pushed_at).toLocaleString())}">${icon("clock")} ${relTime(repo.pushed_at)}</span>
      </div>
      <div class="repo-actions">
        <a class="btn btn-ghost glass btn-sm" href="${routeTo("repo", repo.name)}">${icon("folder")} Browse files</a>
        <a class="btn btn-ghost glass btn-sm" href="${GH.zipUrl(repo)}" ${repo.size === 0 ? 'aria-disabled="true" tabindex="-1" style="opacity:.45;pointer-events:none"' : ""}>${icon("download")} Download ZIP</a>
      </div>
    </article>`;
  }

  function renderRepos() {
    const grid = $("#repo-grid");
    const list = sortedRepos();
    if (!state.repos.length) {
      grid.innerHTML = `<div class="glass grid-span">${emptyState("empty", "No public repositories yet", "New repositories will appear here automatically.")}</div>`;
      return;
    }
    if (!list.length) {
      grid.innerHTML = `<div class="glass grid-span">${emptyState("search", "Nothing matches that search", `No repository matches “${esc(ui.query)}”.`)}</div>`;
      return;
    }
    grid.innerHTML = list.map(repoCard).join("");
    growBars(grid);
  }

  function memberCard(m, i) {
    const anim = !ui.renderedOnce ? ` style="animation: pop-in .7s ${i * 80}ms both"` : "";
    const facts = [
      m.location && `<span>${icon("pin")} ${esc(m.location)}</span>`,
      m.company && `<span>${icon("users")} ${esc(m.company)}</span>`,
    ].filter(Boolean).join("");
    const repoChips = (m.repos || []).map((r) => `<a href="${routeTo("repo", r)}">${esc(r)}</a>`).join("");
    const blog = normUrl(m.blog);
    return `
    <article class="member-card glass${ui.newMembers.has(m.login) ? " is-new" : ""}"${anim}>
      <div class="avatar-ring"><img src="${esc(m.avatar_url)}&s=200" alt="" loading="lazy" width="88" height="88"></div>
      <h3>${esc(m.name || m.login)}</h3>
      <div class="member-login">@${esc(m.login)}</div>
      <span class="badge role ${m.role === "Contributor" ? "" : "member"}">${esc(m.role)}</span>
      ${m.bio ? `<p class="member-bio">${esc(m.bio)}</p>` : ""}
      ${facts ? `<div class="member-facts">${facts}</div>` : ""}
      <div class="member-stats">
        <div><b>${fmtNum(m.contributions)}</b><span>Commits here</span></div>
        <div><b>${fmtNum(m.public_repos)}</b><span>Repos</span></div>
        <div><b>${fmtNum(m.followers)}</b><span>Followers</span></div>
      </div>
      ${repoChips ? `<div class="member-repos">${repoChips}</div>` : ""}
      <div class="member-links">
        <a class="btn btn-ghost glass btn-sm" href="${esc(m.html_url)}" target="_blank" rel="noopener">${icon("github")} Profile</a>
        ${blog ? `<a class="btn btn-ghost glass btn-sm" href="${esc(blog)}" target="_blank" rel="noopener">${icon("globe")} Website</a>` : ""}
      </div>
    </article>`;
  }

  function renderMembers() {
    const grid = $("#member-grid");
    grid.innerHTML = state.members.length
      ? state.members.map(memberCard).join("")
      : `<div class="glass grid-span">${emptyState("empty", "No members to show yet", "Members appear automatically once they join or contribute.")}</div>`;
  }

  function renderSkeletons() {
    const card = `<div class="repo-card glass"><div class="repo-card-head"><div class="skel" style="width:46px;height:46px;border-radius:15px"></div><div style="flex:1"><div class="skel skel-line" style="width:60%;height:16px"></div><div class="skel skel-line" style="width:30%"></div></div></div><div><div class="skel skel-line"></div><div class="skel skel-line" style="width:80%"></div></div><div class="skel" style="height:10px;border-radius:99px"></div><div class="skel skel-line" style="width:50%"></div></div>`;
    $("#repo-grid").innerHTML = card.repeat(3);
    const m = `<div class="member-card glass"><div class="skel" style="width:96px;height:96px;border-radius:50%"></div><div class="skel skel-line" style="width:50%;height:16px;margin-top:14px"></div><div class="skel skel-line" style="width:30%"></div></div>`;
    $("#member-grid").innerHTML = m.repeat(2);
  }

  function renderLoadError(err) {
    const msg = err && err.rateLimited
      ? `GitHub's hourly API limit was reached for your network. Data will load automatically at <b>${fmtTime(GH.rate.reset)}</b>.`
      : "We couldn't reach GitHub. Check your connection. We'll keep retrying.";
    $("#repo-grid").innerHTML = `<div class="glass grid-span">${emptyState("lost", "Can't load repositories", msg, `<a class="btn btn-ghost glass btn-sm" href="https://github.com/${CFG.org}" target="_blank" rel="noopener">${icon("github")} View on GitHub</a>`)}</div>`;
    $("#member-grid").innerHTML = "";
  }

  /* ═════════ Routing ═════════ */
  let route = { view: "home" };

  function parseRoute() {
    const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean).map((p) => {
      try { return decodeURIComponent(p); } catch { return p; }
    });
    if (parts[0] === "repo" && parts[1]) return { view: "repo", repo: parts[1], path: parts.slice(2).join("/") };
    return { view: "home", section: parts[0] || null };
  }

  function onRoute() {
    const prev = route;
    route = parseRoute();
    $("#view-home").hidden = route.view !== "home";
    $("#view-repo").hidden = route.view !== "repo";
    if (route.view === "home") {
      document.title = "TheAxis-Network";
      const target = route.section && document.getElementById(route.section);
      if (target) requestAnimationFrame(() => target.scrollIntoView({ behavior: prev.view === "home" ? "smooth" : "auto", block: "start" }));
      else window.scrollTo({ top: 0, behavior: prev.view === "home" ? "smooth" : "auto" });
    } else {
      const sameRepo = prev.view === "repo" && prev.repo === route.repo;
      showRepo(sameRepo);
      if (!sameRepo) window.scrollTo(0, 0);
    }
  }

  /* ═════════ Repo view ═════════ */
  const view = { name: null, tree: null, index: null, byPath: null, ref: null, seq: 0, fileText: null, fileSha: null };

  const currentRepo = () => state && state.repos.find((r) => r.name.toLowerCase() === route.repo.toLowerCase());

  function buildIndex(tree) {
    const index = new Map([["", []]]);
    const byPath = new Map();
    for (const e of tree) {
      const i = e.path.lastIndexOf("/");
      const parent = i < 0 ? "" : e.path.slice(0, i);
      const entry = { ...e, name: e.path.slice(i + 1) };
      byPath.set(e.path, entry);
      if (!index.has(parent)) index.set(parent, []);
      index.get(parent).push(entry);
      if (e.type === "tree" && !index.has(e.path)) index.set(e.path, []);
    }
    const coll = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
    for (const list of index.values())
      list.sort((a, b) => (a.type === "tree") !== (b.type === "tree") ? (a.type === "tree" ? -1 : 1) : coll.compare(a.name, b.name));
    return { index, byPath };
  }

  async function loadTree(repo) {
    try {
      return await GH.getRepoTree(repo);
    } catch (err) {
      const snap = snapshot && snapshot.trees && snapshot.trees[repo.name];
      if (snap) return snap;
      throw err;
    }
  }

  async function showRepo(sameRepo) {
    const page = $("#repo-page");
    const repo = currentRepo();
    if (!repo) {
      view.name = null;
      const back = `<a class="back-link glass" href="#/repos">${icon("back")} All repositories</a>`;
      if (syncing || (!state && !lastAttempt))
        page.innerHTML = `<div class="explorer glass"><div class="empty-state"><svg class="ic spin" style="width:32px;height:32px"><use href="#i-refresh"/></svg><p>Loading repository…</p></div></div>`;
      else if (!state)
        page.innerHTML = `${back}<div class="explorer glass">${emptyState("lost", "Can't reach GitHub", GH.rate.limited ? `GitHub's hourly API limit was reached. This page will load automatically at <b>${fmtTime(GH.rate.reset)}</b>.` : "We couldn't load repository data. We'll keep retrying.")}</div>`;
      else
        page.innerHTML = `${back}<div class="explorer glass">${emptyState("lost", "Repository not found", `There's no public repository called “${esc(route.repo)}” in ${esc(CFG.org)}.`)}</div>`;
      return;
    }
    document.title = `${repo.name} · TheAxis-Network`;
    if (view.name !== repo.name || !sameRepo || !$("#repo-hero")) {
      page.innerHTML = `
        <a class="back-link glass" href="#/repos">${icon("back")} All repositories</a>
        <div id="repo-hero"></div>
        <div class="repo-body">
          <div class="repo-main" style="display:flex;flex-direction:column;gap:18px;min-width:0">
            <div class="explorer glass" id="explorer"></div>
            <div class="readme glass" id="readme" hidden></div>
          </div>
          <aside class="side" id="repo-side"></aside>
        </div>`;
      renderRepoChrome();
    }
    if (view.name !== repo.name || !view.tree) {
      view.name = repo.name;
      view.tree = null;
      const seq = ++view.seq;
      $("#explorer").innerHTML = explorerLoading();
      try {
        const tree = await loadTree(repo);
        if (seq !== view.seq) return;
        setTree(tree);
      } catch (err) {
        if (seq !== view.seq) return;
        view.name = null;
        $("#explorer").innerHTML = emptyState(
          "lost",
          "Couldn't load files",
          err.rateLimited ? `GitHub's API limit was reached. Try again at <b>${fmtTime(err.reset)}</b>, or download the ZIP.` : "Something went wrong talking to GitHub.",
          `<a class="btn btn-ghost glass btn-sm" href="${GH.zipUrl(repo)}">${icon("download")} Download ZIP</a>`
        );
        return;
      }
    }
    renderExplorer();
  }

  function setTree(tree) {
    view.tree = tree;
    view.ref = tree.sha;
    if (!tree.empty) Object.assign(view, buildIndex(tree.tree));
  }

  const explorerLoading = () =>
    `<div class="explorer-bar"><div class="skel skel-line" style="width:180px"></div></div><div style="padding:12px 18px">${'<div class="skel skel-line" style="height:18px;margin:14px 0"></div>'.repeat(6)}</div>`;

  function renderRepoChrome() {
    const repo = currentRepo();
    const hero = $("#repo-hero");
    if (!repo || !hero) return;
    const clone = `https://github.com/${repo.full_name}.git`;
    const home = normUrl(repo.homepage);
    hero.outerHTML = `
      <section class="repo-hero glass" id="repo-hero">
        <div class="repo-hero-main">
          <div class="repo-icon" style="${repoIconStyle(repo)}">${icon("repo")}</div>
          <div style="min-width:0">
            <div class="org-path">${esc(CFG.org)} /</div>
            <h1>${esc(repo.name)}</h1>
            <p class="repo-desc${repo.description ? "" : " empty"}">${esc(repo.description || "No description provided.")}</p>
            <div class="repo-meta">
              <span>${icon("star")} ${fmtNum(repo.stargazers_count)} stars</span>
              <span>${icon("fork")} ${fmtNum(repo.forks_count)} forks</span>
              <span>${icon("eye")} ${fmtNum(repo.watchers_count)} watching</span>
              ${repo.license && repo.license.spdx_id !== "NOASSERTION" ? `<span title="${esc(repo.license.name)}">${icon("scale")} ${esc(repo.license.spdx_id)}</span>` : ""}
              <span>${icon("clock")} Updated ${relTime(repo.pushed_at)}</span>
              ${repo.size ? `<span>${icon("layers")} ${fmtBytes(repo.size * 1024)}</span>` : ""}
            </div>
            ${repo.topics && repo.topics.length ? `<div class="topics">${repo.topics.map((t) => `<span>${esc(t)}</span>`).join("")}</div>` : ""}
          </div>
        </div>
        <div class="repo-hero-actions">
          <a class="btn btn-primary liquid" href="${GH.zipUrl(repo)}" ${repo.size === 0 ? 'style="opacity:.5;pointer-events:none"' : ""}>
            <span class="liquid-filter"></span><span class="liquid-tint"></span><span class="liquid-shine"></span>
            ${icon("download")} Download ZIP
          </a>
          <a class="btn btn-ghost glass" href="${esc(repo.html_url)}" target="_blank" rel="noopener">${icon("github")} View on GitHub</a>
          ${home ? `<a class="btn btn-ghost glass" href="${esc(home)}" target="_blank" rel="noopener">${icon("globe")} Website</a>` : ""}
          <div class="clone">${icon("terminal")}<span title="${esc(clone)}">${esc(clone)}</span><button class="icon-btn" type="button" data-copy="${esc(clone)}" aria-label="Copy clone URL">${icon("copy")}</button></div>
        </div>
      </section>`;

    const { list, total } = langEntries(repo.languages);
    const langPanel = list.length
      ? `<div class="langbar lg">${list.map((l) => `<span data-w="${l.pct.toFixed(3)}" style="background:${l.color}" title="${esc(l.name)} ${fmtPct(l.pct)}"></span>`).join("")}</div>
         <ul class="lang-table">${list
           .map((l) => `<li><span class="dot" style="background:${l.color}"></span><span>${esc(l.name)}</span><span class="pct">${fmtPct(l.pct)}</span><span class="meter"><i data-w="${l.pct.toFixed(3)}" style="background:${l.color}"></i></span><span class="bytes">${fmtBytes(l.bytes)}</span></li>`)
           .join("")}</ul>
         <p class="muted" style="font-size:.78rem;margin:16px 0 0">${fmtBytes(total)} of code, measured by GitHub Linguist</p>`
      : `<div class="lang-none">${icon("code")} No language data for this repository yet.</div>`;
    const contribs = repo.contributors.length
      ? `<div class="contrib-list">${repo.contributors
          .slice(0, 12)
          .map((c) => `<a href="https://github.com/${esc(c.login)}" target="_blank" rel="noopener"><img src="${esc(c.avatar_url)}&s=64" alt="" loading="lazy">@${esc(c.login)}<span>${fmtNum(c.contributions)} commits</span></a>`)
          .join("")}</div>`
      : `<p class="muted" style="margin:0;font-size:.88rem">No contributors yet.</p>`;
    const side = $("#repo-side");
    side.innerHTML = `
      <div class="panel glass"><h3>${icon("pulse")} Languages</h3>${langPanel}</div>
      <div class="panel glass"><h3>${icon("users")} Contributors</h3>${contribs}</div>`;
    growBars(side);
  }

  function crumbs(repo, path) {
    const segs = path ? path.split("/") : [];
    let acc = "";
    const parts = [`<a href="${routeTo("repo", repo.name)}">${esc(repo.name)}</a>`];
    for (const s of segs) {
      acc = acc ? `${acc}/${s}` : s;
      parts.push(`${icon("chevron")}<a href="${routeTo("repo", repo.name, acc)}">${esc(s)}</a>`);
    }
    return `<nav class="crumbs" aria-label="Path">${parts.join("")}</nav>`;
  }

  const ext = (name) => (name.includes(".") ? name.split(".").pop().toLowerCase() : name.toLowerCase());
  const IMG = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "ico", "bmp", "avif"]);
  const VID = new Set(["mp4", "webm", "mov", "m4v"]);
  const AUD = new Set(["mp3", "wav", "ogg", "flac", "m4a", "aac"]);
  const MD = new Set(["md", "markdown", "mdx"]);
  const BIN = new Set(["zip", "gz", "tgz", "tar", "7z", "rar", "exe", "dll", "so", "dylib", "woff", "woff2", "ttf", "otf", "eot", "pdf", "jar", "class", "wasm", "bin", "psd", "dat", "db", "sqlite", "pyc", "o", "a", "lib", "iso", "dmg", "apk"]);
  const MIME = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", ico: "image/x-icon", bmp: "image/bmp", avif: "image/avif", mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime", m4v: "video/mp4", mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", flac: "audio/flac", m4a: "audio/mp4", aac: "audio/aac" };
  const HL = { js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "javascript", ts: "typescript", tsx: "typescript", mts: "typescript", lua: "lua", luau: "lua", html: "xml", htm: "xml", xml: "xml", svg: "xml", css: "css", scss: "scss", less: "less", json: "json", md: "markdown", markdown: "markdown", sh: "bash", bash: "bash", zsh: "bash", py: "python", yml: "yaml", yaml: "yaml", toml: "ini", ini: "ini", go: "go", rs: "rust", c: "c", h: "c", cpp: "cpp", hpp: "cpp", cc: "cpp", java: "java", kt: "kotlin", rb: "ruby", php: "php", ps1: "powershell", bat: "dos", cmd: "dos", dockerfile: "dockerfile", makefile: "makefile", sql: "sql", swift: "swift", cs: "csharp", gitignore: "bash", env: "bash" };

  function fileIcon(e) {
    if (e.type === "tree") return "folder";
    if (e.type === "commit") return "branch";
    const x = ext(e.name);
    if (IMG.has(x)) return "image";
    if (MD.has(x) || x === "txt" || /^(license|readme|changelog)/i.test(e.name)) return "doc";
    if (BIN.has(x)) return "zip";
    return HL[x] ? "code" : "file";
  }

  function renderExplorer() {
    const repo = currentRepo();
    const box = $("#explorer");
    if (!repo || !box || !view.tree) return;
    const readme = $("#readme");
    view.fileText = null;
    view.fileSha = null;

    if (view.tree.empty) {
      readme.hidden = true;
      box.innerHTML = emptyState("empty", "This repository is empty", "Nothing has been pushed yet. Files will show up here automatically once they are.");
      return;
    }
    const path = route.path || "";
    const entry = path ? view.byPath.get(path) : { type: "tree" };
    if (!entry) {
      readme.hidden = true;
      box.innerHTML = `<div class="explorer-bar">${crumbs(repo, path)}</div>${emptyState("lost", "Path not found", "This file or folder doesn't exist on the default branch. It may have been moved or deleted.", `<a class="btn btn-ghost glass btn-sm" href="${routeTo("repo", repo.name)}">${icon("back")} Back to root</a>`)}`;
      return;
    }
    if (entry.type === "tree") renderListing(repo, path, box, readme);
    else renderFile(repo, entry, box, readme);
  }

  function renderListing(repo, path, box, readmeBox) {
    const items = view.index.get(path) || [];
    const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    const rows = items
      .map((e) => {
        const href = e.type === "commit" ? "" : routeTo("repo", repo.name, e.path);
        const action = e.type === "tree"
          ? `<button class="icon-btn" type="button" data-action="zip" data-path="${esc(e.path)}" title="Download folder as ZIP" aria-label="Download ${esc(e.name)} as ZIP">${icon("zip")}</button>`
          : e.type === "blob"
            ? `<button class="icon-btn" type="button" data-action="dl" data-path="${esc(e.path)}" title="Download file" aria-label="Download ${esc(e.name)}">${icon("download")}</button>`
            : "<span></span>";
        return `<li class="file-row ${e.type === "tree" ? "dir" : ""}">
          ${icon(fileIcon(e), "kind")}
          ${href ? `<a class="fname" href="${href}">${esc(e.name)}</a>` : `<span class="fname" title="Submodule">${esc(e.name)}</span>`}
          <span class="size">${e.type === "blob" ? fmtBytes(e.size) : e.type === "tree" ? `${(view.index.get(e.path) || []).length} items` : "submodule"}</span>
          ${action}
        </li>`;
      })
      .join("");
    const up = path ? `<li class="file-row up">${icon("back", "kind")}<a class="fname" href="${routeTo("repo", repo.name, parent)}">..</a><span></span><span></span></li>` : "";
    box.innerHTML = `
      <div class="explorer-bar">
        <div style="display:flex;align-items:center;flex-wrap:wrap;gap:6px;min-width:0"><span class="branch">${icon("branch")} ${esc(repo.default_branch)}</span>${crumbs(repo, path)}</div>
        <div class="explorer-actions">
          ${path
            ? `<button class="btn btn-ghost glass btn-sm" type="button" data-action="zip" data-path="${esc(path)}">${icon("zip")} Download folder</button>`
            : `<button class="btn btn-ghost glass btn-sm" type="button" data-action="zip" data-path="">${icon("zip")} Zip in browser</button>`}
          <a class="btn btn-ghost glass btn-sm" href="${GH.zipUrl(repo)}">${icon("download")} Repo ZIP</a>
        </div>
      </div>
      ${view.tree.truncated ? `<div class="notice">This repository is very large; GitHub returned a partial file list.</div>` : ""}
      <ul class="file-list">${up}${rows || `<li class="file-row"><span></span><span class="muted">Empty folder</span></li>`}</ul>`;

    const readme = items.find((e) => e.type === "blob" && /^readme(\.(md|markdown|mdx|txt|rst))?$/i.test(e.name));
    if (!readme) {
      readmeBox.hidden = true;
      return;
    }
    readmeBox.hidden = false;
    readmeBox.innerHTML = `<div class="readme-head">${icon("doc")} ${esc(readme.name)}</div><div class="md"><div class="skel skel-line"></div><div class="skel skel-line" style="width:70%"></div></div>`;
    const seq = view.seq;
    fetchText(repo, readme.path)
      .then((text) => {
        if (seq !== view.seq || route.path !== path) return;
        const md = $(".md", readmeBox);
        if (MD.has(ext(readme.name))) renderMarkdown(md, text, repo, path);
        else md.innerHTML = `<pre style="white-space:pre-wrap;margin:0">${esc(text)}</pre>`;
      })
      .catch(() => (readmeBox.hidden = true));
  }

  async function fetchRaw(repo, path) {
    const res = await fetch(GH.rawUrl(repo, view.ref, path));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res;
  }
  const fetchText = (repo, path) => fetchRaw(repo, path).then((r) => r.text());

  async function renderFile(repo, entry, box, readmeBox) {
    readmeBox.hidden = true;
    const x = ext(entry.name);
    const raw = GH.rawUrl(repo, view.ref, entry.path);
    const seq = ++view.seq;
    view.fileSha = entry.sha;
    const head = (info) => `
      <div class="explorer-bar">
        <div style="display:flex;align-items:center;flex-wrap:wrap;gap:6px;min-width:0"><span class="branch">${icon("branch")} ${esc(repo.default_branch)}</span>${crumbs(repo, entry.path)}</div>
      </div>
      <div class="viewer-head">
        <div class="file-info">${icon(fileIcon(entry))}<b>${esc(entry.name)}</b>${info}</div>
        <div class="explorer-actions">
          <a class="btn btn-ghost glass btn-sm" href="${raw}" target="_blank" rel="noopener">${icon("external")} Raw</a>
          <button class="btn btn-ghost glass btn-sm" type="button" data-action="copy-file" hidden>${icon("copy")} Copy</button>
          <button class="btn btn-primary liquid btn-sm" type="button" data-action="dl" data-path="${esc(entry.path)}"><span class="liquid-filter"></span><span class="liquid-tint"></span><span class="liquid-shine"></span>${icon("download")} Download</button>
        </div>
      </div>`;
    const sizeInfo = `<span>${fmtBytes(entry.size)}</span>`;
    box.innerHTML = head(sizeInfo) + `<div class="code-wrap"><div class="gutter"> </div><pre><code>${'<div class="skel skel-line" style="width:60%"></div>'.repeat(8)}</code></pre></div>`;

    const binaryView = (msg) =>
      `<div class="binary-view">${ART.binary}<p>${msg}</p><button class="btn btn-primary liquid" type="button" data-action="dl" data-path="${esc(entry.path)}"><span class="liquid-filter"></span><span class="liquid-tint"></span><span class="liquid-shine"></span>${icon("download")} Download ${esc(entry.name)}</button></div>`;
    const setBody = (html, info = sizeInfo) => {
      if (seq !== view.seq) return false;
      box.innerHTML = head(info) + html;
      return true;
    };

    try {
      if (IMG.has(x) || VID.has(x) || AUD.has(x)) {
        const blob = await (await fetchRaw(repo, entry.path)).blob();
        const url = URL.createObjectURL(new Blob([blob], { type: MIME[x] || blob.type }));
        const media = IMG.has(x)
          ? `<img src="${url}" alt="${esc(entry.name)}">`
          : VID.has(x)
            ? `<video src="${url}" controls playsinline></video>`
            : `<audio src="${url}" controls></audio>`;
        setBody(`<div class="media-view">${media}</div>`);
        return;
      }
      if (BIN.has(x)) return void setBody(binaryView("This is a binary file and can't be previewed here."));
      if (entry.size > 2 * 1024 * 1024) return void setBody(binaryView(`This file is ${fmtBytes(entry.size)}, too large to preview.`));

      const text = await fetchText(repo, entry.path);
      if (seq !== view.seq) return;
      if (text.slice(0, 8000).includes("\u0000")) return void setBody(binaryView("This is a binary file and can't be previewed here."));
      view.fileText = text;
      const lines = text.endsWith("\n") ? text.slice(0, -1).split("\n") : text.split("\n");
      const info = `${sizeInfo}<span>·</span><span>${lines.length.toLocaleString()} lines</span>`;

      if (MD.has(x)) {
        if (!setBody(`<div class="md"></div>`, info)) return;
        renderMarkdown($(".md", box), text, repo, entry.path.includes("/") ? entry.path.slice(0, entry.path.lastIndexOf("/")) : "");
      } else {
        const gutter = lines.map((_, i) => i + 1).join("\n");
        if (!setBody(`<div class="code-wrap"><div class="gutter">${gutter}</div><pre><code class="hljs">${highlight(text, entry.name)}</code></pre></div>`, info)) return;
      }
      const copyBtn = $('[data-action="copy-file"]', box);
      if (copyBtn) copyBtn.hidden = false;
    } catch (err) {
      setBody(binaryView("Couldn't load a preview of this file."));
    }
  }

  function highlight(text, name) {
    const hljs = window.hljs;
    if (!hljs || text.length > 400_000) return esc(text);
    const x = ext(name);
    const lang = HL[x] || HL[name.toLowerCase()];
    try {
      if (lang && hljs.getLanguage(lang)) return hljs.highlight(text, { language: lang, ignoreIllegals: true }).value;
      if (text.length < 60_000) return hljs.highlightAuto(text).value;
    } catch {}
    return esc(text);
  }

  function resolvePath(base, rel) {
    rel = rel.split(/[?#]/)[0];
    const out = rel.startsWith("/") ? [] : base ? base.split("/") : [];
    for (const seg of rel.split("/")) {
      if (!seg || seg === ".") continue;
      if (seg === "..") out.pop();
      else out.push(decodeURIComponent(seg));
    }
    return out.join("/");
  }

  function renderMarkdown(el, text, repo, dir) {
    if (!window.marked || !window.DOMPurify) {
      el.innerHTML = `<pre style="white-space:pre-wrap;margin:0">${esc(text)}</pre>`;
      return;
    }
    el.innerHTML = window.DOMPurify.sanitize(window.marked.parse(text, { gfm: true }));
    const isAbs = (u) => /^([a-z][a-z0-9+.-]*:|\/\/)/i.test(u);
    for (const img of $$("img[src]", el)) {
      const src = img.getAttribute("src");
      const m = src.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/blob\/(.+)$/);
      if (m) img.src = `https://raw.githubusercontent.com/${m[1]}/${m[2]}`;
      else if (!isAbs(src) && !src.startsWith("data:")) img.src = GH.rawUrl(repo, view.ref, resolvePath(dir, src));
      img.loading = "lazy";
    }
    for (const a of $$("a[href]", el)) {
      const href = a.getAttribute("href");
      if (href.startsWith("#")) {
        a.addEventListener("click", (e) => e.preventDefault());
      } else if (!isAbs(href)) {
        a.setAttribute("href", routeTo("repo", repo.name, resolvePath(dir, href)));
      } else {
        a.target = "_blank";
        a.rel = "noopener";
      }
    }
    if (window.hljs) $$("pre code", el).forEach((c) => { try { window.hljs.highlightElement(c); } catch {} });
  }

  /** Re-fetch the open repo's tree when a sync reports it changed. */
  async function onRepoChanges(changes) {
    if (route.view !== "repo") return;
    const repo = currentRepo();
    if (!repo || view.name !== repo.name) return showRepo(false);
    if (!view.tree) return;
    if (!changes.updatedRepos.some((r) => r.name === repo.name)) return;
    try {
      const tree = await GH.getRepoTree(repo);
      if (view.name !== repo.name || tree.sha === view.ref) return;
      const openFileSha = view.fileSha;
      setTree(tree);
      const nowEntry = route.path && view.byPath ? view.byPath.get(route.path) : null;
      // Keep an unchanged open file as-is; refresh listings and changed files.
      if (!openFileSha || !nowEntry || nowEntry.sha !== openFileSha) renderExplorer();
      toast(`Files in <b>${esc(repo.name)}</b> refreshed to the latest commit`, { iconId: "refresh" });
    } catch {}
  }

  /* ═════════ Downloads ═════════ */
  function saveBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement("a"), { href: url, download: name });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  async function downloadFile(path) {
    const repo = currentRepo();
    const name = path.split("/").pop();
    const t = toast(`Downloading <b>${esc(name)}</b>…`, { iconId: "download", timeout: 0 });
    try {
      const blob = await (await fetchRaw(repo, path)).blob();
      saveBlob(blob, name);
      t.body.innerHTML = `Downloaded <b>${esc(name)}</b>`;
    } catch {
      t.body.innerHTML = `Couldn't download <b>${esc(name)}</b>.`;
    }
    setTimeout(t.close, 2500);
  }

  let jszipPromise;
  function loadJSZip() {
    if (window.JSZip) return Promise.resolve(window.JSZip);
    jszipPromise ||= new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
      s.onload = () => resolve(window.JSZip);
      s.onerror = () => { jszipPromise = null; reject(new Error("Failed to load JSZip")); };
      document.head.appendChild(s);
    });
    return jszipPromise;
  }

  async function downloadFolder(path) {
    const repo = currentRepo();
    const prefix = path ? path + "/" : "";
    const files = view.tree.tree.filter((e) => e.type === "blob" && e.path.startsWith(prefix));
    const folderName = path ? path.split("/").pop() : repo.name;
    const zipName = path ? `${repo.name}-${path.replace(/\//g, "-")}.zip` : `${repo.name}.zip`;
    if (!files.length) return toast("This folder has no files to download.", { iconId: "folder" });
    if (files.length > 1500) {
      toast(`That folder has ${files.length.toLocaleString()} files. Use <b>Repo ZIP</b> instead.`, { iconId: "zip" });
      return;
    }
    const t = toast(`Zipping <b>${esc(folderName)}</b>… <span class="pg">0/${files.length}</span><div class="progress"><i></i></div>`, { iconId: "zip", timeout: 0 });
    try {
      const JSZip = await loadJSZip();
      const zip = new JSZip();
      const root = zip.folder(folderName);
      let done = 0;
      const queue = [...files];
      const worker = async () => {
        while (queue.length) {
          const f = queue.shift();
          const blob = await (await fetchRaw(repo, f.path)).blob();
          root.file(f.path.slice(prefix.length), blob);
          done++;
          $(".pg", t.body).textContent = `${done}/${files.length}`;
          $(".progress i", t.body).style.width = `${(done / files.length) * 90}%`;
        }
      };
      await Promise.all(Array.from({ length: 6 }, worker));
      const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
      $(".progress i", t.body).style.width = "100%";
      saveBlob(blob, zipName);
      t.body.innerHTML = `Downloaded <b>${esc(zipName)}</b>`;
    } catch (err) {
      t.body.innerHTML = `Couldn't build the ZIP. Try <a href="${GH.zipUrl(repo)}"><b>Repo ZIP</b></a> instead.`;
    }
    setTimeout(t.close, 3500);
  }

  /* ═════════ Wiring ═════════ */
  function initTheme() {
    $("#theme-toggle").addEventListener("click", () => {
      const root = document.documentElement;
      const dark = root.dataset.theme ? root.dataset.theme === "dark" : !matchMedia("(prefers-color-scheme: light)").matches;
      root.dataset.theme = dark ? "light" : "dark";
      try { localStorage.setItem("axis:theme", root.dataset.theme); } catch {}
    });
  }

  function initEvents() {
    $("#sync-pill").addEventListener("click", () => sync({ manual: true }));
    $("#repo-search").addEventListener("input", (e) => {
      ui.query = e.target.value;
      if (state) renderRepos();
    });
    $$(".seg button").forEach((b) =>
      b.addEventListener("click", () => {
        $$(".seg button").forEach((x) => x.classList.toggle("on", x === b));
        ui.sort = b.dataset.sort;
        if (state) renderRepos();
      })
    );
    $("#repo-grid").addEventListener("pointermove", (e) => {
      const card = e.target.closest(".repo-card");
      if (!card) return;
      const r = card.getBoundingClientRect();
      card.style.setProperty("--mx", `${e.clientX - r.left}px`);
      card.style.setProperty("--my", `${e.clientY - r.top}px`);
    });
    document.addEventListener("click", (e) => {
      const link = e.target.closest('a[href^="#/"]');
      if (link && link.getAttribute("href") === location.hash) {
        e.preventDefault();
        return onRoute();
      }
      const copyBtn = e.target.closest("[data-copy]");
      if (copyBtn) return copyText(copyBtn.dataset.copy, copyBtn);
      const act = e.target.closest("[data-action]");
      if (!act) return;
      const { action, path } = act.dataset;
      if (action === "dl") downloadFile(path);
      else if (action === "zip") downloadFolder(path);
      else if (action === "copy-file" && view.fileText != null) copyText(view.fileText, act);
    });
    window.addEventListener("hashchange", onRoute);

    // Scroll-spy for nav links
    const links = new Map($$(".nav-links a").map((a) => [a.getAttribute("href").slice(2), a]));
    const spy = new IntersectionObserver(
      (entries) => entries.forEach((en) => {
        const a = links.get(en.target.id);
        if (a && en.isIntersecting) links.forEach((l) => l.classList.toggle("active", l === a));
      }),
      { rootMargin: "-45% 0px -50% 0px" }
    );
    ["repos", "members", "contact"].forEach((id) => spy.observe(document.getElementById(id)));

    const reveal = new IntersectionObserver(
      (entries) => entries.forEach((en) => en.isIntersecting && (en.target.classList.add("in"), reveal.unobserve(en.target))),
      { rootMargin: "0px 0px -8% 0px" }
    );
    $$(".reveal").forEach((el) => reveal.observe(el));

    if (matchMedia("(prefers-reduced-motion: reduce)").matches) $$("svg.orbit-svg").forEach((s) => s.pauseAnimations && s.pauseAnimations());
  }

  async function boot() {
    $("#year").textContent = new Date().getFullYear();
    initTheme();
    initEvents();
    route = parseRoute();

    const cached = GH.LS.get("axis:state");
    snapshot = await GH.loadSnapshot();
    const snapState = snapshot && snapshot.repos ? { org: snapshot.org, repos: snapshot.repos, members: snapshot.members, syncedAt: snapshot.syncedAt, source: "snapshot" } : null;
    state = [cached, snapState].filter(Boolean).sort((a, b) => b.syncedAt - a.syncedAt)[0] || null;

    if (state) {
      renderAll();
      updatePill(state.source === "snapshot" ? "snapshot" : "live");
    } else {
      renderSkeletons();
    }
    onRoute();
    await sync();
    scheduleLoop();
  }

  boot();
})();
