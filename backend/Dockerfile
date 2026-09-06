FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

# Пакет ставится после копирования исходников: pyproject объявляет packages=["app"],
# а этого каталога до COPY ещё нет. Колёса shapely несут GEOS с собой,
# поэтому системные библиотеки геометрии ставить не нужно.
COPY . .
RUN pip install --no-cache-dir -e .

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
