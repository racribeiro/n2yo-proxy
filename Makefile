.PHONY: build build-backend up up-backend down run logs dev

# -------------------------------------------------
# Load configuration from a .env file (if it exists)
# -------------------------------------------------
-include .env
# Export variables defined in .env so they become normal environment
# variables for the commands that follow.  Lines that are empty or start
# with ‘#’ are ignored.
export $(shell sed -E 's/^([^#=]+)=.*/\1/' .env 2>/dev/null | tr '\n' ' ')

# Default ports (can be overridden via .env)
PORT ?= $(FRONTEND_PORT)

build:
	docker compose build

build-backend:
	docker compose build backend

up:
	docker compose up -d --build

up-backend:
	docker compose up -d --build backend

down:
	docker compose down

run:
	docker compose up --build

logs:
	docker compose logs -f

# Development target – backend runs detached, frontend attached
## -----------------------------------------------------------------
## Development helpers
## -----------------------------------------------------------------
## `make dev` starts the backend detached and attaches to the frontend.
## `make docker-run` runs the full stack in a container passing any env vars.
## -----------------------------------------------------------------

dev:
	# Start the backend in the background
	docker compose up -d backend
	# Attach to the frontend (source bind‑mounted for hot reload)
	docker compose up frontend

# Run the entire application using Docker, forwarding all env vars defined in .env
docker-run:
	@echo "Starting containers with environment variables..."
	docker compose up --build
