.PHONY: build up down run logs

build:
	docker compose build

up:
	docker compose up -d

down:
	docker compose down

run:
	docker compose up --build

logs:
	docker compose logs -f
