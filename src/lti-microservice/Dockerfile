FROM python:3.10-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY lti_tester.py .

EXPOSE 4000

CMD ["python", "lti_tester.py"]

