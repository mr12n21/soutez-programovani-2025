from flask import Flask, render_template, request, session, jsonify, redirect, url_for
from collections import Counter
import random
import logging

app = Flask(__name__)
app.secret_key = 'super_tajny_klic_logik_2025'
