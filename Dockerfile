FROM node:8.6

WORKDIR /usr/src
COPY app/ /usr/src/
RUN npm install --production
EXPOSE 8080
EXPOSE 4430
ENTRYPOINT [ "/usr/local/bin/node", "index.js" ]
