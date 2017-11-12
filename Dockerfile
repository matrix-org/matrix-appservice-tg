FROM node:6-slim

RUN apt-get update && apt-get install -y git \
    --no-install-recommends \
&& rm -rf /var/lib/apt/lists/*

RUN mkdir /app \
 && ln -s /data/users.db /app/user-store.db \
 && ln -s /data/rooms.db /app/data-store.db \
 && ln -s /data/registration.yaml /app/telegram-registration.yaml

WORKDIR /app

ADD hash-password.pl index.js package.json ./
ADD lib ./lib
ADD config ./config

RUN npm install

ENTRYPOINT ["node", "index.js"]
