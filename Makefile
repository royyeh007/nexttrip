# Makefile for lily-japan-trip (React + TypeScript + Vite)
#
#   make            -> install deps (if needed) and start the dev server
#   make start      -> same as above
#   make PORT=3000  -> start the dev server on another port
#   make build      -> type-check and build the production bundle into dist/
#   make preview    -> serve the production build locally
#   make lint       -> run eslint
#   make clean      -> remove dist/
#   make reset      -> remove dist/ and node_modules/

NPM  ?= npm
PORT ?= 5173

.DEFAULT_GOAL := start

.PHONY: start dev install build preview lint clean reset help

## Start the Vite dev server (installs dependencies first if missing)
start: node_modules
	$(NPM) run dev -- --port $(PORT)

dev: start

## Install dependencies
install: node_modules

# Re-run npm install only when package.json / package-lock.json change
node_modules: package.json package-lock.json
	$(NPM) install
	@touch node_modules

## Type-check and build for production
build: node_modules
	$(NPM) run build

## Serve the production build locally
preview: build
	$(NPM) run preview -- --port $(PORT)

## Run eslint
lint: node_modules
	$(NPM) run lint

## Remove build output
clean:
	rm -rf dist

## Remove build output and installed dependencies
reset: clean
	rm -rf node_modules

## Show this help
help:
	@echo "Usage: make [target] [PORT=5173]"
	@echo ""
	@echo "Targets:"
	@echo "  start (default)  install deps if needed, then start the dev server"
	@echo "  install          npm install"
	@echo "  build            tsc -b && vite build  -> dist/"
	@echo "  preview          serve dist/ locally"
	@echo "  lint             eslint ."
	@echo "  clean            remove dist/"
	@echo "  reset            remove dist/ and node_modules/"
	@echo ""
	@echo "Supabase:"
	@echo "  link REF=<ref>   link to your Supabase project"
	@echo "  db-push          create tables, policies, buckets"
	@echo "  fn-deploy        deploy all Edge Functions"
	@echo "  secrets          store the Claude key (asks for it; nothing is echoed)"
	@echo "  seed             add what seed/trip.ts has and the database lacks (never overwrites)"
	@echo "  seed-overwrite   replace the database's days/flights/todos with seed/trip.ts (asks first)"
	@echo "  test             run the logic tests"
	@echo "  usage [N=15]     what the AI chat cost, per day and for the last N replies"
	@echo "  setup            db-push + fn-deploy + seed"

# ---------- Supabase ----------
REF ?=

## Add what seed/trip.ts has and the database does not (families, days, todos, form, invites).
## Rows that already exist are left alone: people have edited them on the site since.
seed: node_modules
	node seed/seed.mjs

## Replace what is in the database with seed/trip.ts. Loses edits made on the site; asks for the trip's name first.
seed-overwrite: node_modules
	node seed/seed.mjs --overwrite

## Logic tests (no network, no database)
test: node_modules
	$(NPM) test

## Show what the AI chat cost (per day, and the last N replies): make usage N=30
N ?= 15
usage: node_modules
	node seed/usage.mjs $(N)

## Link this folder to your Supabase project: make link REF=<project-ref>
link:
	supabase link --project-ref $(REF)

## Create the tables / policies / buckets in the linked project
db-push:
	supabase db push

## Deploy all Edge Functions
fn-deploy:
	supabase functions deploy parse-upload --no-verify-jwt
	supabase functions deploy chat --no-verify-jwt
	supabase functions deploy flight-status --no-verify-jwt
	supabase functions deploy flight-refresh --no-verify-jwt
	supabase functions deploy optimize-day --no-verify-jwt
	supabase functions deploy format-info --no-verify-jwt
	supabase functions deploy card-lookup --no-verify-jwt
	supabase functions deploy match-place --no-verify-jwt
	supabase functions deploy translate-card --no-verify-jwt
	supabase functions deploy place-search --no-verify-jwt

## Store the Claude API key for the Edge Functions. Asks for the key instead of taking it on the command line,
## so it does not end up in the terminal scrollback or the shell history; an empty answer changes nothing.
secrets:
	@printf "ANTHROPIC_API_KEY (sk-ant-…，輸入時不會顯示)："; stty -echo; read KEY; stty echo; echo; \
	if [ -z "$$KEY" ]; then echo "沒有輸入，沒有改動。"; exit 1; fi; \
	supabase secrets set "ANTHROPIC_API_KEY=$$KEY" >/dev/null && echo "已存進 Supabase。"

## Store the Google Places key for the place search (same way: asked for, never echoed).
secrets-places:
	@printf "GOOGLE_PLACES_KEY (輸入時不會顯示)："; stty -echo; read KEY; stty echo; echo; \
	if [ -z "$$KEY" ]; then echo "沒有輸入，沒有改動。"; exit 1; fi; \
	supabase secrets set "GOOGLE_PLACES_KEY=$$KEY" >/dev/null && echo "已存進 Supabase。"

## Everything after `make link`: tables, functions, data (seed only adds what is missing)
setup: db-push fn-deploy seed

.PHONY: seed seed-overwrite test link db-push fn-deploy secrets secrets-places setup

## Push auth settings incl. Google login (needs GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET in .env.local).
## Shows what will change in the hosted project and asks before applying: read the list, in particular the e-mail sign-up lines.
auth-push:
	@set -a; . ./.env.local; set +a; supabase config push

.PHONY: auth-push
