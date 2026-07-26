// pm2 config — run:  pm2 start ecosystem.config.cjs
// Set RIOT_API_KEY in the shell before starting (never commit it):
//   PowerShell: $env:RIOT_API_KEY='RGAPI-...' ; pm2 start ecosystem.config.cjs
//   Linux:      RIOT_API_KEY='RGAPI-...' pm2 start ecosystem.config.cjs
module.exports = {
  apps: [
    {
      name: 'lol-fairness-api',
      script: 'server.mjs',
      cwd: __dirname,
      env: {
        PORT: 3131,
        // CORS_ORIGIN: 'https://your-app.vercel.app', // tighten in production
      },
      max_restarts: 10,
      autorestart: true,
    },
  ],
};
