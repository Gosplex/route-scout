#!/usr/bin/env bash
# Route Scout: one-command startup
#   ./start.sh            set up (first run), check keys, start the dev server and open the browser
#   ./start.sh prod       production build + start (closest to what Vercel runs)
#   ./start.sh snapshot   record a live run for the demo button
#   ./start.sh keys       re-enter your API keys
set -euo pipefail
cd "$(dirname "$0")"

MODE="${1:-dev}"
PORT="${PORT:-3000}"
ENV_FILE=".env.local"

pink=$'\033[38;5;205m'; cyan=$'\033[38;5;51m'; amber=$'\033[38;5;214m'; dim=$'\033[2m'; bold=$'\033[1m'; off=$'\033[0m'
say()  { printf "%s\n" "${cyan}▸${off} $*"; }
warn() { printf "%s\n" "${amber}!${off} $*"; }
fail() { printf "%s\n" "${pink}✗${off} $*"; exit 1; }

printf "\n%s\n%s\n\n" "${bold}${pink}ROUTE ${cyan}SCOUT${off}" "${dim}Find where your people are.${off}"

# 1. Node.js 18.18+
command -v node >/dev/null 2>&1 || fail "Node.js is not installed. Get the LTS version from https://nodejs.org and run this again."
NODE_OK=$(node -e 'const [a,b]=process.versions.node.split(".").map(Number);console.log(a>18||(a===18&&b>=18)?1:0)')
[ "$NODE_OK" = "1" ] || fail "Node.js $(node -v) is too old. Install 18.18 or newer from https://nodejs.org"
say "Node $(node -v)"

# 2. Dependencies
if [ ! -d node_modules ] || [ package-lock.json -nt node_modules ]; then
  say "Installing dependencies (first run takes a minute)…"
  npm install --no-audit --no-fund
fi

# 3. Keys
set_key() { # set_key NAME VALUE  (safe for any characters in the value)
  KEY_NAME="$1" KEY_VALUE="$2" node -e '
    const fs = require("fs"); const f = ".env.local";
    const name = process.env.KEY_NAME, val = process.env.KEY_VALUE;
    let lines = fs.existsSync(f) ? fs.readFileSync(f, "utf8").split("\n") : [];
    const i = lines.findIndex(l => l.startsWith(name + "="));
    if (i >= 0) lines[i] = `${name}=${val}`; else lines.push(`${name}=${val}`);
    fs.writeFileSync(f, lines.join("\n"));'
}
get_key() { grep -E "^$1=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- || true; }

ask_key() { # ask_key NAME "Label" required|optional
  local current; current="$(get_key "$1")"
  if [ -n "$current" ] && [ "$MODE" != "keys" ]; then return; fi
  local hint="press Enter to skip"; [ "$3" = "required" ] && hint="required for live results"
  [ -n "$current" ] && hint="press Enter to keep the current one"
  printf "%s" "${bold}$2${off} ${dim}($hint)${off}: "
  local value; IFS= read -r value || true
  value="$(printf "%s" "$value" | tr -d '[:space:]')"
  if [ -n "$value" ]; then set_key "$1" "$value"; fi
}

if [ ! -f "$ENV_FILE" ]; then
  cp .env.example "$ENV_FILE"
  say "Created $ENV_FILE from .env.example"
fi

if [ -t 0 ]; then
  if [ -z "$(get_key QLOO_API_KEY)" ] || [ "$MODE" = "keys" ]; then
    say "Let's add your API keys. They stay on this computer in $ENV_FILE (never committed)."
    ask_key QLOO_API_KEY "Qloo API key" required
    ask_key TICKETMASTER_API_KEY "Ticketmaster key (developer.ticketmaster.com)" optional
    ask_key OPENROUTER_API_KEY "OpenRouter key (openrouter.ai/keys)" optional
    if [ -n "$(get_key OPENROUTER_API_KEY)" ]; then
      printf "%s" "${bold}OpenRouter model${off} ${dim}(Enter keeps: $(get_key OPENROUTER_MODEL || echo openai/gpt-4o-mini))${off}: "
      IFS= read -r model || true
      model="$(printf "%s" "$model" | tr -d '[:space:]')"
      [ -n "$model" ] && set_key OPENROUTER_MODEL "$model"
    fi
  fi
fi
[ -z "$(get_key QLOO_BASE_URL)" ] && set_key QLOO_BASE_URL "https://hackathon.api.qloo.com"
set_key NEXT_PUBLIC_SITE_URL "$(get_key NEXT_PUBLIC_SITE_URL | grep -E '^https://' || echo "http://localhost:$PORT")"

if [ "$MODE" = "keys" ]; then say "Keys saved."; MODE=dev; fi

# 4. Check keys (never blocks: the demo works without them)
if [ -n "$(get_key QLOO_API_KEY)" ]; then
  say "Checking your keys…"
  npm run --silent check:keys || warn "Qloo key check failed. The app still starts; the demo works without keys."
else
  warn "No Qloo key yet, so only the demo will work. Run ./start.sh keys to add it."
fi

open_browser() {
  ( for _ in $(seq 1 60); do
      if curl -s -o /dev/null "http://localhost:$PORT/api/health"; then
        if command -v open >/dev/null; then open "http://localhost:$PORT"
        elif command -v xdg-open >/dev/null; then xdg-open "http://localhost:$PORT" >/dev/null 2>&1
        fi; break
      fi; sleep 1
    done ) &
}

# 5. Go
case "$MODE" in
  dev)
    say "Starting Route Scout at ${bold}http://localhost:$PORT${off}  ${dim}(Ctrl+C to stop)${off}"
    open_browser
    exec npx next dev -p "$PORT"
    ;;
  prod)
    say "Building for production…"
    npm run build
    say "Starting production server at ${bold}http://localhost:$PORT${off}"
    open_browser
    exec npx next start -p "$PORT"
    ;;
  snapshot)
    [ -n "$(get_key QLOO_API_KEY)" ] || fail "Recording a live demo needs a Qloo key. Run ./start.sh keys first."
    shift || true
    say "Recording a live run for the demo button…"
    npm run snapshot -- "$@"
    say "Done. Commit data/demo/*.json and redeploy so judges see it."
    ;;
  *)
    fail "Unknown option '$MODE'. Use: ./start.sh, ./start.sh prod, ./start.sh snapshot, or ./start.sh keys"
    ;;
esac
