#!/usr/bin/env python3
"""Train a TF-IDF + Keras dense-network classifier for expense categories.

Pipeline:
  1. Load the labeled CSV (description, category).
  2. Vectorize descriptions with TF-IDF (unigrams + bigrams, top 500 features).
  3. Train a small feed-forward net (128 -> 64 -> softmax) with cross-entropy.
  4. Save expense_classifier.h5, the vectorizer, and the label encoder to model/.

Run inside the ML virtualenv:  python train.py
"""
import os
import pickle

import numpy as np
import pandas as pd
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics import classification_report
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import LabelEncoder
import tensorflow as tf
from tensorflow.keras import layers, models

BASE = os.path.dirname(os.path.abspath(__file__))
DATA_PATH = os.path.join(BASE, "data", "expenses.csv")
MODEL_DIR = os.path.join(BASE, "model")


def load_data():
    df = pd.read_csv(DATA_PATH)
    df["description"] = df["description"].astype(str).str.lower().str.strip()
    df = df.dropna(subset=["description", "category"])
    df = df[df["description"] != ""]
    return df


def build_model(input_dim, num_classes):
    model = models.Sequential([
        layers.Input(shape=(input_dim,)),
        layers.Dense(128, activation="relu"),
        layers.Dropout(0.3),
        layers.Dense(64, activation="relu"),
        layers.Dense(num_classes, activation="softmax"),
    ])
    model.compile(
        optimizer="adam",
        loss="categorical_crossentropy",
        metrics=["accuracy"],
    )
    return model


def main():
    os.makedirs(MODEL_DIR, exist_ok=True)
    df = load_data()
    print(f"Loaded {len(df)} rows across {df['category'].nunique()} categories")

    vectorizer = TfidfVectorizer(max_features=500, ngram_range=(1, 2))
    X = vectorizer.fit_transform(df["description"]).toarray()

    encoder = LabelEncoder()
    y = encoder.fit_transform(df["category"])
    num_classes = len(encoder.classes_)
    y_onehot = tf.keras.utils.to_categorical(y, num_classes)

    X_train, X_test, y_train, y_test = train_test_split(
        X, y_onehot, test_size=0.2, random_state=42, stratify=y
    )

    model = build_model(X.shape[1], num_classes)
    model.fit(
        X_train, y_train,
        validation_data=(X_test, y_test),
        epochs=50, batch_size=16, verbose=2,
    )

    loss, acc = model.evaluate(X_test, y_test, verbose=0)
    print(f"\nHeld-out test accuracy: {acc:.3f}")

    y_pred = np.argmax(model.predict(X_test, verbose=0), axis=1)
    y_true = np.argmax(y_test, axis=1)
    print("\nClassification report:")
    print(classification_report(y_true, y_pred, target_names=encoder.classes_, zero_division=0))

    model.save(os.path.join(MODEL_DIR, "expense_classifier.h5"))
    with open(os.path.join(MODEL_DIR, "vectorizer.pkl"), "wb") as f:
        pickle.dump(vectorizer, f)
    with open(os.path.join(MODEL_DIR, "label_encoder.pkl"), "wb") as f:
        pickle.dump(encoder, f)
    print(f"\nSaved expense_classifier.h5, vectorizer.pkl, label_encoder.pkl to {MODEL_DIR}/")


if __name__ == "__main__":
    main()
