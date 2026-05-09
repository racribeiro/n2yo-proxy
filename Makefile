.PHONY: build up down run logs

PORT ?= 5173

build:
	PORT=$(PORT) docker compose build

up:
	PORT=$(PORT) docker compose up -d

down:
	PORT=$(PORT) docker compose down

run:
	PORT=$(PORT) docker compose up --build

logs:
	PORT=$(PORT) docker compose logs -f
