/* Site configuration — edit freely. */
window.AXIS_CONFIG = {
  org: "TheAxis-Network",
  email: "support@axisnet.work",
  website: "https://axisnet.work",

  // How often the site re-checks GitHub for new/updated repos and members (ms).
  // Conditional requests (ETags) are used, so unchanged data doesn't cost rate limit.
  refreshInterval: 5 * 60 * 1000,

  // Members are discovered automatically from public org members and from
  // everyone who has contributed to an org repo. List extra GitHub usernames
  // here to always show them (e.g. members whose org membership is private).
  members: ["yaanscoat"],

  // Optional role labels shown on member cards: { "username": "Founder" }
  roles: {},

  // Usernames to never show (bots are already filtered out).
  hiddenMembers: [],

  // Repository names to hide from the site.
  hiddenRepos: [],

  // Snapshot written by scripts/sync.mjs (and the GitHub Action). Used for an
  // instant first paint and as a fallback while the GitHub API is rate limited.
  snapshotUrl: "data/snapshot.json",
};
