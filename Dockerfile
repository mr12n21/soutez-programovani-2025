FROM python:3.9-slim

WORKDIR /app

# Zkopíruj requirements.txt z lokální složky do kontejneru
COPY app/requirements.txt /app/

# Nainstaluj závislosti
RUN pip install -r requirements.txt

# Zkopíruj zbytek aplikace
COPY app /app/

# Spusť aplikaci pomocí Gunicorn
CMD ["gunicorn", "-b", "0.0.0.0:5000", "app:app"]
