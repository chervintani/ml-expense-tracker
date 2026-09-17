#!/usr/bin/env python3
"""Stateless ML microservice: classifies an expense description into a category.

Loads the trained model + vectorizer + label encoder once at startup and serves
/predict and /health. No database access, no business logic — pure inference.

Run inside the ML virtualenv:  python app.py
Default port 5001 (5000 is used by AirPlay Receiver on macOS).
"""
import os
import pickle
import time

import numpy as np
from flask import Flask, jsonify, request
from flask_cors import CORS
import tensorflow as tf

BASE = os.path.dirname(os.path.abspath(__file__))
MODEL_DIR = os.path.join(BASE, "model")
PORT = int(os.environ.get("ML_SERVICE_PORT", "5001"))
MODEL_VERSION = "1.0"

app = Flask(__name__)
CORS(app)

# --- Load artifacts once at startup (not per request) ---
model = tf.keras.models.load_model(os.path.join(MODEL_DIR, "expense_classifier.h5"))
with open(os.path.join(MODEL_DIR, "vectorizer.pkl"), "rb") as f:
    vectorizer = pickle.load(f)
with open(os.path.join(MODEL_DIR, "label_encoder.pkl"), "rb") as f:
    label_encoder = pickle.load(f)
LABELS = list(label_encoder.classes_)


@app.get("/health")
def health():
    """Liveness check; reports the model version and known categories."""
    return jsonify(status="ok", model_version=MODEL_VERSION, classes=LABELS)


@app.post("/predict")
def predict():
    payload = request.get_json(silent=True) or {}
    description = str(payload.get("description", "")).lower().strip()
    if not description:
        return jsonify(error="'description' is required"), 400

    start = time.time()
    features = vectorizer.transform([description]).toarray()
    probabilities = model.predict(features, verbose=0)[0]
    latency_ms = int((time.time() - start) * 1000)

    top = int(np.argmax(probabilities))
    return jsonify(
        category=LABELS[top],
        confidence=round(float(probabilities[top]), 4),
        all_probs={label: round(float(p), 4) for label, p in zip(LABELS, probabilities)},
        latency_ms=latency_ms,
        model_version=MODEL_VERSION,
    )


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=PORT)
