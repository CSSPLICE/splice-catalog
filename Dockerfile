FROM node:lts-buster-slim AS development

WORKDIR /app

COPY package.json yarn.lock ./
RUN yarn install
RUN yarn global add ts-node

COPY . .

FROM development as dev-envs
RUN <<EOF
    apt-get update
    apt-get install -y --no-install-recommends git
EOF

RUN <<EOF
    useradd -s /bin/bash -m deploy
    groupadd docker
    usermod -aG docker deploy
EOF

USER deploy
