FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Cloud Run expects one HTTP listener per container.
# Use BACKEND_SERVICE=swarm for the Genkit service, otherwise run diagnosis FastAPI.
ENV BACKEND_SERVICE=diagnosis
ENV PORT=8000

EXPOSE 8000

CMD ["sh", "-c", "if [ \"$BACKEND_SERVICE\" = \"swarm\" ]; then python swarm/main.py; else cd diagnosis && uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}; fi"]
