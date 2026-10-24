// Optional Telegram bot (CONTRACT: LIVE lane). Not built: this is a deliberate no-op so `npm run bot` never crashes.
// It reads no token value, prints nothing secret and makes no network call. Use /capture on a phone instead.
if (!process.env.TELEGRAM_BOT_TOKEN) {
  console.log("Telegram bot: TELEGRAM_BOT_TOKEN is not set, so there is nothing to start. Use /capture on a phone instead.")
} else {
  console.log("Telegram bot: not implemented in this build (by choice). Nothing was started or sent. Use /capture on a phone instead.")
}
