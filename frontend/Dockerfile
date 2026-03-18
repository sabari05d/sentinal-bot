FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

# Copy all source files
COPY . .

# Expose port 5173 for Vite
EXPOSE 5173

# Start Vite server
CMD ["npm", "run", "dev", "--", "--host"]
