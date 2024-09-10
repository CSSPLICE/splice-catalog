.DEFAULT_GOAL:=help
COMPOSE_COMMAND := docker compose
DEV_PROFILE := --profile catalog
PROD_PROFILE := --profile production
.PHONY: build test up down nuke restart help

build: ## This builds the images
	$(COMPOSE_COMMAND) $(DEV_PROFILE) build

rebuild: ## This builds the images with no-cache
	$(COMPOSE_COMMAND) $(DEV_PROFILE) build --no-cache

up: build ## This brings up the app
	$(COMPOSE_COMMAND) $(DEV_PROFILE) up

down: ## This takes down the app
	$(COMPOSE_COMMAND) $(DEV_PROFILE) down

exec: ## This execs into the running catalog container
	$(COMPOSE_COMMAND) $(DEV_PROFILE) exec catalog sh

nuke: ## This removes all the volumes as well as taking down the app
	$(COMPOSE_COMMAND) $(DEV_PROFILE) down -v

restart: down up ## This restarts the app

deploy: ## This deploys prod
	$(COMPOSE_COMMAND) $(PROD_PROFILE) up -d

build-prod: ## This builds prod
	$(COMPOSE_COMMAND) $(PROD_PROFILE) build

down-prod: ## This takes down prod
	$(COMPOSE_COMMAND) $(PROD_PROFILE) down

help: ## This is the help dialog
	@awk 'BEGIN {FS = ":.*##"; printf "\nUsage:\n  make \033[36m<target>\033[0m\n\nTargets:\n"} /^[a-zA-Z_-]+:.*?##/ { printf "  \033[36m%-10s\033[0m %s\n", $$1, $$2 }' $(MAKEFILE_LIST)
