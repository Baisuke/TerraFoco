# Arquitectura — TerraFoco

Todos los diagramas están escritos en **Mermaid**, que GitHub renderiza de forma
nativa. Para editarlos basta modificar el bloque de código; para previsualizar antes
de hacer commit, pegar el bloque en [mermaid.live](https://mermaid.live).

---

## 1. Diagrama de contexto

Qué es el sistema, quién lo usa y con qué se conecta hacia afuera.

```mermaid
flowchart LR
    ANA["Analista territorial"]
    ENC["Encargado de programa<br/>INDAP · SAG · municipio"]
    ADM["Administrador de datos"]

    SIS["TerraFoco<br/>Plataforma de análisis<br/>geoespacial"]

    SAT["Repositorios satelitales<br/>NASA · Copernicus · USGS"]
    GEO["Servicios geoespaciales<br/>CIREN · IDE Chile · IDE MINAGRI"]
    ADMIN["Datos administrativos<br/>INDAP · SAG · ODEPA · SENAPRED"]

    ANA -->|consulta indicadores| SIS
    ENC -->|evalúa focalización| SIS
    ADM -->|administra fuentes| SIS

    SAT -->|imágenes y modelos de elevación| SIS
    GEO -->|capas vectoriales| SIS
    ADMIN -->|ejecución de programas| SIS
```

---

## 2. Diagrama de componentes

La vista principal. Cinco capas: fuentes externas, núcleo, módulos analíticos,
servicios y presentación.

```mermaid
flowchart LR
    subgraph EXT["Fuentes externas"]
        SRTM["NASA SRTM<br/>DEM 30 m"]
        S2["Sentinel-2<br/>Multiespectral"]
        LSAT["Landsat<br/>Banda térmica"]
        CIREN["CIREN<br/>Inventario erosión"]
        IDE["IDE Chile<br/>y MINAGRI"]
        TRANS["INDAP y SAG<br/>Transparencia"]
    end

    subgraph NUC["Núcleo"]
        PROG["Programador<br/>cadencia por fuente"]
        ING["Ingesta"]
        NOR["Normalización"]
        ETL["ETL administrativo"]
        BD[("PostgreSQL<br/>PostGIS")]
    end

    subgraph MOD["Módulos analíticos"]
        M1["Módulo 1<br/>Erosión y pertinencia"]
        M2["Módulo 2<br/>Inundaciones"]
        M3["Módulo 3<br/>Térmico urbano"]
        MLC["Transversal<br/>Modelado predictivo"]
    end

    subgraph SRV["Servicios"]
        API["API REST<br/>FastAPI"]
        OGC["GeoServer<br/>WMS · WFS"]
    end

    subgraph PRE["Presentación"]
        WEB["Visor cartográfico<br/>React + MapLibre"]
        DASH["Tablero<br/>Power BI"]
    end

    SRTM --> ING
    S2 --> ING
    LSAT --> ING
    CIREN --> ING
    IDE --> ING
    TRANS --> ETL

    PROG -.->|dispara| ING
    PROG -.->|dispara| ETL
    ING --> NOR
    NOR --> BD
    ETL --> BD
    BD -.->|programación| PROG

    BD --> M1
    BD --> M2
    BD --> M3

    M1 --> MLC
    M2 --> MLC
    M3 --> MLC

    M1 --> API
    M2 --> API
    M3 --> API
    MLC --> API
    BD --> OGC

    API --> WEB
    OGC --> WEB
    API --> DASH
```

### Responsabilidades por componente

| Componente | Responsabilidad | Tecnología |
|---|---|---|
| **Programador** | Decide qué ingesta corre y cuándo, según la cadencia propia de cada fuente. Resuelve dependencias y no ejecuta un indicador si su ingesta falló | Python; ver [documento 09](09-orquestacion.md) |
| Ingesta | Conexión a repositorios de origen y descarga de insumos | Python, requests, earthaccess |
| Normalización | Reproyección a un sistema común, remuestreo y recorte al área de interés | GDAL, Rasterio |
| ETL administrativo | Consolidación de planillas mensuales de Transparencia Activa | Python, Pandas |
| Base de datos | Persistencia con indexación espacial y versionado temporal | PostgreSQL + PostGIS |
| Módulo 1 | Factor C actualizado, contraste con línea base, índice de pertinencia | Rasterio, GeoPandas, NumPy |
| Módulo 2 | Derivados hidrológicos y análisis multicriterio | RichDEM, NumPy |
| Módulo 3 | Temperatura superficial, NDVI, déficit de área verde | Rasterio, NumPy |
| Modelado predictivo | Comparación de tres algoritmos y selección del mejor | scikit-learn, XGBoost |
| API REST | Exposición de indicadores con documentación automática | FastAPI |
| GeoServer | Publicación de capas por estándares OGC | GeoServer |
| Visor | Cartografía interactiva en navegador | React, MapLibre GL JS |
| Tablero | Indicadores agregados para gestión | Power BI |

---

## 3. Flujo de procesamiento del módulo de erosión

Cómo se produce el indicador principal, de la imagen satelital al índice.

```mermaid
flowchart LR
    A["Sentinel-2<br/>imágenes recientes"] --> B["Cálculo de NDVI"]
    B --> C["Factor C<br/>cobertura vegetal"]
    D["SRTM"] --> E["Pendiente y longitud"]
    E --> F["Factor LS"]
    G["Estudios CIREN"] --> H["Factor K"]
    I["Series de precipitación"] --> J["Factor R"]
    K["Ejecución SIRSD-S"] --> L["Factor P"]

    C --> M["RUSLE<br/>A = R x K x LS x C x P"]
    F --> M
    H --> M
    J --> M
    L --> M

    M --> N["Erosión estimada<br/>t/ha/año por comuna"]
    O["Línea base CIREN"] --> P["Comparación temporal"]
    N --> P
    N --> Q["Índice de pertinencia<br/>necesidad frente a inversión"]
    K --> Q
```

---

## 4. Diagrama de secuencia

Recorrido de una consulta desde el navegador hasta la base de datos.

```mermaid
sequenceDiagram
    actor U as Analista territorial
    participant V as Visor web
    participant A as API REST
    participant M as Módulo analítico
    participant D as PostGIS

    U->>V: Selecciona capa y comuna
    V->>A: GET /indicadores?comuna=litueche&capa=erosion
    A->>M: Solicita indicador calculado
    M->>D: Consulta espacial sobre la comuna
    D-->>M: Geometría y valores agregados
    M-->>A: Indicador y metadatos
    A-->>V: Respuesta JSON
    V-->>U: Renderiza mapa y ficha comunal
```

---

## 5. Diagrama de despliegue

```mermaid
flowchart TB
    subgraph CLIENTE["Cliente"]
        NAV["Navegador web"]
    end

    subgraph SERVIDOR["Servidor de aplicación — contenedores Docker"]
        direction TB
        FRONT["Contenedor: Frontend<br/>React servido por Nginx"]
        BACK["Contenedor: API<br/>FastAPI + Uvicorn"]
        GS["Contenedor: GeoServer"]
        DB[("Contenedor: PostgreSQL + PostGIS")]
    end

    subgraph BATCH["Procesamiento por lotes"]
        WORK["Contenedor: Worker de procesamiento<br/>Python + GDAL"]
    end

    subgraph NUBE["Servicios externos"]
        REPO["Repositorios satelitales"]
    end

    NAV -->|HTTPS| FRONT
    FRONT -->|REST| BACK
    FRONT -->|WMS| GS
    BACK --> DB
    GS --> DB
    WORK --> DB
    WORK -->|descarga programada| REPO
```

> El procesamiento pesado corre como worker por lotes, separado de la API. Así una
> ingesta de imágenes no bloquea las consultas del visor.

---

## 6. Modelo de datos conceptual

```mermaid
erDiagram
    REGION ||--o{ COMUNA : contiene
    COMUNA ||--o{ INDICADOR_EROSION : registra
    COMUNA ||--o{ EJECUCION_PROGRAMA : recibe
    COMUNA ||--o{ INDICE_PERTINENCIA : obtiene
    COMUNA ||--o{ INDICADOR_INUNDACION : registra
    CIUDAD ||--o{ UNIDAD_VECINAL : contiene
    COMUNA ||--o{ CIUDAD : contiene
    UNIDAD_VECINAL ||--o{ INDICADOR_URBANO : registra
    FUENTE ||--o{ CAPA : publica
    CAPA ||--o{ EJECUCION_INGESTA : alimenta
    PROGRAMA ||--o{ EJECUCION_PROGRAMA : financia

    REGION {
        int id_region PK
        string nombre
        geometry geom
    }
    COMUNA {
        int id_comuna PK
        int id_region FK
        string nombre
        string provincia
        float superficie_km2
        geometry geom
    }
    INDICADOR_EROSION {
        int id PK
        int id_comuna FK
        int anio
        float factor_r
        float factor_k
        float factor_ls
        float factor_c
        float factor_p
        float perdida_ton_ha_anio
        string clase
    }
    PROGRAMA {
        int id_programa PK
        string nombre
        string organismo
    }
    EJECUCION_PROGRAMA {
        int id PK
        int id_comuna FK
        int id_programa FK
        int anio
        float superficie_bonificada_ha
        float monto_mm
        int beneficiarios
        string tipo_practica
    }
    INDICE_PERTINENCIA {
        int id PK
        int id_comuna FK
        int anio
        float necesidad
        float intensidad_inversion
        float indice
        string categoria
    }
    INDICADOR_INUNDACION {
        int id PK
        int id_comuna FK
        float susceptibilidad
        string clase
    }
    CIUDAD {
        int id_ciudad PK
        int id_comuna FK
        string nombre
    }
    UNIDAD_VECINAL {
        int id_uv PK
        int id_ciudad FK
        string nombre
        int habitantes
        geometry geom
    }
    INDICADOR_URBANO {
        int id PK
        int id_uv FK
        float temperatura_superficial
        float ndvi
        float area_verde_m2_hab
    }
    FUENTE {
        int id_fuente PK
        string nombre
        string organismo
        string tipo
    }
    CAPA {
        int id_capa PK
        int id_fuente FK
        string nombre
        string formato
        date ultima_actualizacion
    }
    EJECUCION_INGESTA {
        int id PK
        int id_capa FK
        datetime fecha
        int duracion_min
        string estado
    }
```

---

## 7. Decisiones de arquitectura

| Decisión | Alternativa descartada | Motivo |
|---|---|---|
| PostGIS como base de datos | Archivos GeoTIFF en disco | Permite consultas de superposición y agregación espacial directamente en la base, sin cargar el raster completo en memoria |
| Worker separado para procesamiento | Procesar dentro de la API | Una ingesta de imágenes tarda minutos; bloquear la API haría inusable el visor |
| MapLibre GL en vez de Leaflet | Leaflet | Renderizado vectorial acelerado por GPU, necesario para el volumen de polígonos comunales |
| API REST propia además de GeoServer | Solo GeoServer | GeoServer publica capas, pero no expone los indicadores calculados ni el índice de pertinencia |
| Python en toda la cadena | Python para datos y Node para la API | Un solo lenguaje entre procesamiento y backend reduce la duplicación de lógica de negocio |
| Contenedores Docker | Instalación directa en el servidor | GDAL y PostGIS tienen dependencias del sistema difíciles de reproducir; el contenedor garantiza el mismo entorno en las tres máquinas del equipo |
