# This Dockerfile demonstrates the Blessed Base Image pattern described in Part 2.
# In a real organisation, replace the FROM line with your platform team's curated image:
#   FROM ghcr.io/your-org/devcontainer-base-node:20.11.0
#
# The base image is maintained centrally and includes:
#   - Pinned OS version and mandatory security patches
#   - Internal CA certificates and audit tooling
#   - Non-root user setup (vscode, UID 1000)
#
# Product teams own only what is below the FROM line.
# Dependabot watches this file and raises a PR when a new tag is published.
FROM mcr.microsoft.com/devcontainers/base:ubuntu-22.04

# Only application-specific system packages belong here.
# Organisation-wide tooling should be added upstream to the blessed base image.
RUN apt-get update && apt-get install -y --no-install-recommends \
    postgresql-client \
    redis-tools \
    && rm -rf /var/lib/apt/lists/*
