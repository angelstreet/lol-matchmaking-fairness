// GET /api/keycheck  (x-api-key header required)
// Cheap, no-cache, no-quota self-diagnosis endpoint: tells the frontend whether a pasted key is
// actually valid against Riot right now, independent of whatever /api/matches or /api/analyze
// might separately report. Exists because a 401/403 surfaced from those endpoints can legitimately
// belong to the SHARED server key (see api/analyze.mjs's error-attribution comment) rather than
// the user's own — this endpoint always tests the exact key the client sends, nothing else.
//
// /lol/status/v4/platform-data is used as the probe: it requires a valid key like any other Riot
// endpoint, but is otherwise free of account lookups, rate-limit-heavy lists, or per-player data
// — about as cheap as a real validity check gets. Platform is hardcoded to euw1 since key
// validity isn't region-specific in Riot's system.
import { makeClient } from '../lib/riot.mjs';

export default async function handler(req, res) {
  const key = req.headers['x-api-key'];
  if (!key) return res.status(400).json({ valid: false, status: 0, error: 'no key provided' });
  try {
    const c = makeClient(key, 'euw');
    await c.api(c.platform, '/lol/status/v4/platform-data');
    return res.status(200).json({ valid: true });
  } catch (e) {
    // lib/riot.mjs's api() collapses 401 and 403 into one friendly, status-less message — good
    // enough here since this endpoint only needs to report "invalid" plus a best-effort code, not
    // reproduce Riot's exact status. Any other non-ok response embeds its real status in the
    // message ("Riot 500 on ...") which we do surface exactly.
    const m = /^Riot (\d+) on/.exec(e.message || '');
    const status = m ? Number(m[1]) : 401;
    return res.status(200).json({ valid: false, status });
  }
}
