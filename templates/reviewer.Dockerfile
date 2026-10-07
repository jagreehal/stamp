# Build from an empty context: never send the PR checkout to docker build.
FROM node:22.18.0-bookworm-slim@sha256:752ea8a2f758c34002a0461bd9f1cee4f9a3c36d48494586f60ffce1fc708e0e
RUN apt-get update && apt-get install -y --no-install-recommends git ripgrep ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g @anthropic-ai/claude-code@2.1.293 @openai/codex@0.161.0
USER 1000:1000
ENV HOME=/home/node
WORKDIR /review
