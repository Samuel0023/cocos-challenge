.PHONY: services dev up down test test-aws lint typecheck

# Testcontainers needs the socket of the active Docker context (Colima, OrbStack, Docker Desktop).
DOCKER_HOST ?= $(shell docker context inspect --format '{{.Endpoints.docker.Host}}' 2>/dev/null)
TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE ?= /var/run/docker.sock
export DOCKER_HOST
export TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE

COMPOSE_ALL := docker compose -f compose.yaml -f compose.aws.yaml --profile api

# AWS Emulator writes per-run credentials, config and ca.pem here (bind mount of the container).
AWS_EMULATOR_DIR := $(CURDIR)/.aws-emulator/9297

# Host process -> emulator on 127.0.0.1:9297. Real AWS keys are unset: the emulator rejects them.
AWS_ENV := env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY -u AWS_SESSION_TOKEN -u AWS_PROFILE \
	AWS_ENABLED=true \
	CONSUMER_ENABLED=true \
	AWS_ENDPOINT_URL=https://127.0.0.1:9297 \
	AWS_REGION=us-east-1 \
	ORDER_EVENTS_TOPIC_ARN=arn:aws:sns:us-east-1:000000000000:order-events \
	ORDER_EVENTS_QUEUE_URL=https://sqs.us-east-1.amazonaws.com/000000000000/order-events-queue \
	AWS_SHARED_CREDENTIALS_FILE=$(AWS_EMULATOR_DIR)/emulator_credentials \
	AWS_CONFIG_FILE=$(AWS_EMULATOR_DIR)/config \
	NODE_EXTRA_CA_CERTS=$(AWS_EMULATOR_DIR)/ca.pem \
	AWS_EC2_METADATA_DISABLED=true

services: ## Start PostgreSQL, Valkey, AWS Emulator (with the topic and queue), Prometheus and Grafana
	mkdir -p .aws-emulator
	docker compose up -d --wait postgres valkey aws-emulator prometheus grafana
	docker compose run --rm aws-init

dev: ## Run the API on the host against the Docker services, with SNS/SQS on AWS Emulator
	$(AWS_ENV) npm run dev

up: ## Start everything in Docker (API, Prometheus and Grafana included), SNS/SQS on AWS Emulator
	mkdir -p .aws-emulator
	$(COMPOSE_ALL) up -d --build --wait

down: ## Stop and remove the containers
	$(COMPOSE_ALL) down

test: ## Run unit and functional tests (needs Docker)
	npm test

test-aws: ## Run the SNS -> SQS integration test against AWS Emulator (after make services)
	$(AWS_ENV) AWS_EMULATOR_TESTS=true npx vitest run test/order-events/aws-emulator.integration.test.ts

lint: ## Run ESLint and Prettier
	npm run lint

typecheck: ## Run the TypeScript compiler without emitting
	npm run typecheck
