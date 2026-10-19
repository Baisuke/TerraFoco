# =============================================================================
# Motor de procesamiento geoespacial
#
# Se parte de la imagen oficial de OSGeo en vez de instalar GDAL por pip.
# Instalar GDAL a mano es la primera fuente de "en mi computador funciona":
# la version del binario y la del binding de Python tienen que coincidir, y
# eso difiere entre Windows, macOS y Linux.
# =============================================================================

FROM ghcr.io/osgeo/gdal:ubuntu-small-3.9.2

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

# python3-venv permite instalar sin chocar con los paquetes del sistema
RUN apt-get update && apt-get install -y --no-install-recommends \
        python3-pip python3-venv postgresql-client \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN python3 -m venv /opt/venv \
    && /opt/venv/bin/pip install --upgrade pip \
    && /opt/venv/bin/pip install -r requirements.txt

# El venv hereda GDAL del sistema
ENV PATH="/opt/venv/bin:$PATH" \
    PYTHONPATH=/app

COPY . .

CMD ["tail", "-f", "/dev/null"]
