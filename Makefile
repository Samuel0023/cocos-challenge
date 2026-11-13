.PHONY: services dev up down test lint typecheck

# Testcontainers needs the socket of the active Docker context (Colima, OrbStack, Docker Desktop).
DOCKER_HOST ?= $(shell docker context inspect --format '{{.Endpoints.docker.Host}}' 2>/dev/null)
TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE ?= /var/run/docker.sock
export DOCKER_HOST
export TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE

services: ## Start PostgreSQL and Valkey in Docker
	docker compose up -d --wait postgres valkey

dev: ## Run the API on the host against the Docker services
	npm run dev

up: ## Start everything in Docker, API included
	docker compose --profile api up -d --build --wait

down: ## Stop and remove the containers
	docker compose --profile api down

test: ## Run unit and functional tests (needs Docker)
	npm test

lint: ## Run ESLint and Prettier
	npm run lint

typecheck: ## Run the TypeScript compiler without emitting
	npm run typecheck
