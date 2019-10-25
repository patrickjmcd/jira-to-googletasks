FROM node:lts-alpine

WORKDIR /usrc
COPY package*.json ./
RUN npm install
COPY . . 
CMD ["npm", "start"]
