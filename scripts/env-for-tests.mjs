// Loaded before every test file (see the "test" script). Most tests were written when new workspaces started on the generous
// "beta" plan; they keep doing so here. The real default (Free) is checked on its own in server/defaultPlan.test.ts.
process.env.DEFAULT_NEW_WORKSPACE_PLAN ??= 'beta';
